import {
  barcodePrintHandoffSchema,
  catalogMatchingBatchSchema,
  CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
  generateDisplayName,
  isProductNameTemplateVersion,
  catalogDenialSchema,
  productBarcodeSuggestionResponseSchema,
  productSearchResponseSchema,
  productSchema,
  type BarcodePrintHandoff,
  type CatalogMatchingApprovalRequest,
  type CatalogMatchingBatch,
  type CatalogMatchingBatchOpenRequest,
  type CatalogDenial,
  type CatalogDenialCode,
  type CatalogFieldError,
  type Product,
  type ProductBarcode,
  type ProductBarcodeAddRequest,
  type ProductBarcodeInput,
  type ProductBarcodePrintRequest,
  type ProductBarcodeSuggestRequest,
  type ProductBarcodeSuggestionResponse,
  type ProductArchiveRequest,
  type ProductCreateRequest,
  type ProductDefinition,
  type ProductEditRequest,
  type ProductMergeRequest,
  type InventoryCapableUnit,
  type ProductNameTemplateVersion,
  type ProductPackaging,
  type ProductPricing,
  type ProductSearchRequest,
  type ProductSearchResponse,
} from "@breev/contracts/local-rest";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";

import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { writePostingAudit } from "../posting/audit-writer.js";
import { canonicalRequestHash } from "../posting/canonical-hash.js";
import { runWholeCommandWithRetry } from "../posting/command-retry.js";
import {
  PostingIdempotencyConflict,
  beginPostingIdempotency,
  recordPostingResult,
  type PostingCommandReplay,
} from "../posting/idempotency.js";
import {
  UNIT_INTERFACES,
  defaultUnitFor,
  definePackaging,
  type Packaging,
  type PackagingProblem,
  type UnitInterface,
} from "./catalog-packaging.js";
import {
  resolveCatalogPricing,
  type CatalogPricing,
  type CatalogPricingProblemCode,
} from "./catalog-pricing.js";
import { matchesOrderedProductName } from "./catalog-search.js";

const CATALOG_PERMISSION = "catalog.item.manage";
const CATALOG_SEARCH_PERMISSION = "catalog.item.search";
const BARCODE_LOCK_NAMESPACE = 165_308_863;
const MATCHING_LOCK_NAMESPACE = 165_308_864;

const COMMANDS = {
  addBarcode: "catalog.barcode.add",
  archive: "catalog.product.archive",
  create: "catalog.product.create",
  edit: "catalog.product.edit",
  matchingApprove: "catalog.matching.approve",
  matchingOpen: "catalog.matching.open",
  merge: "catalog.product.merge",
  printBarcode: "catalog.barcode.print",
  suggestBarcode: "catalog.barcode.suggest",
} as const;

type CatalogCommandName = (typeof COMMANDS)[keyof typeof COMMANDS];

interface ProductRow {
  readonly ai_sharing_allowed: boolean;
  readonly arabic_search_name: string | null;
  readonly barcodes: ProductBarcode[];
  readonly category: string | null;
  readonly cold_storage_required: boolean;
  readonly definition_mode: "general-item" | "medication";
  readonly display_name: string;
  readonly externally_visible: boolean;
  readonly food_timing:
    "after-food" | "before-food" | "regardless-of-food" | null;
  readonly general_company: string | null;
  readonly general_property: string | null;
  readonly general_size: string | null;
  readonly general_sub_brand: string | null;
  readonly general_target_audience: string | null;
  readonly general_type_of_use: string | null;
  readonly id: string;
  readonly inventory_unit_name: string;
  readonly manual_state_colour:
    "blue" | "green" | "grey" | "orange" | "purple" | "red" | "yellow" | null;
  readonly medication_dosage_form: string | null;
  readonly medication_manufacturer: string | null;
  readonly medication_strength: string | null;
  readonly medication_trade_name: string | null;
  readonly merged_into_product_id: string | null;
  readonly name_template_version: number;
  readonly package_units: readonly {
    readonly baseUnitsPerPackage: string;
    readonly name: string;
  }[];
  readonly pharmacy_id: string;
  readonly price_rounding:
    "nearest-1000-iqd" | "nearest-250-iqd" | "nearest-500-iqd" | "off" | null;
  readonly pricing_method: "by-percentage" | "by-price";
  readonly margin_percentage: string | null;
  readonly retail_price_fils: string;
  readonly revision: string;
  readonly scientific_name: string | null;
  readonly status: "active" | "archived" | "merged";
  readonly third_unit_name: string | null;
  readonly count_default_kind: "inventory" | "package";
  readonly count_default_name: string;
  readonly purchase_default_kind: "inventory" | "package";
  readonly purchase_default_name: string;
  readonly sale_default_kind: "inventory" | "package";
  readonly sale_default_name: string;
  readonly uses_per_day: number | null;
  readonly uses_per_month: number | null;
  readonly uses_per_week: number | null;
  readonly wholesale_price_fils: string | null;
}

interface CommandSuccess<T> {
  readonly afterState: Record<string, boolean | number | string | null>;
  readonly beforeState?: Record<string, boolean | number | string | null>;
  readonly response: T;
  readonly targetId?: string;
}

interface CommandExecution<T> {
  readonly commandName: CatalogCommandName;
  readonly context: IdentityExecutionContext;
  readonly idempotencyKey: string;
  readonly requestHash: Buffer;
  readonly responseStatus: 200 | 201;
  readonly responseSchema: { parse(value: unknown): T };
  readonly targetId?: string;
  readonly work: (client: PoolClient) => Promise<CommandSuccess<T>>;
}

export class CatalogDenied extends Error {
  public constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly denial: CatalogDenial,
  ) {
    super(denial.code);
    this.name = "CatalogDenied";
  }
}

class CatalogCommandRejected extends Error {
  public constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: CatalogDenialCode,
    public readonly fieldErrors: readonly CatalogFieldError[] = [],
    public readonly targetId?: string,
  ) {
    super(code);
    this.name = "CatalogCommandRejected";
  }
}

@Injectable()
export class CatalogService {
  public constructor(
    private readonly localDatabase: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
  ) {}

  public async list(request: Request): Promise<{ products: Product[] }> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    const result = await this.localDatabase.requirePool().query<ProductRow>(
      `${PRODUCT_SELECT}
       where product_row.pharmacy_id = $1
       order by product_row.created_at, product_row.id`,
      [context.pharmacyId],
    );
    return { products: result.rows.map(productView) };
  }

  public async read(request: Request, productId: string): Promise<Product> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    const product = await selectProduct(
      this.localDatabase.requirePool(),
      context.pharmacyId,
      productId,
    );
    if (product !== undefined) {
      return productView(product);
    }
    throw await this.readDenial(
      context,
      "catalog.product.read",
      "product-not-found",
      productId,
    );
  }

  public async create(
    request: Request,
    input: ProductCreateRequest,
  ): Promise<Product> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    const requestHash = canonicalRequestHash(COMMANDS.create, input);
    return await this.executeCommand({
      commandName: COMMANDS.create,
      context,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      responseStatus: 201,
      responseSchema: productSchema,
      work: async (client) => {
        const validated = validateCatalogAttributes(input);
        await ensureBarcodesAvailable(
          client,
          context.pharmacyId,
          undefined,
          input.barcodes,
        );
        const displayName = generatedName(
          input.definition,
          CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
        );
        const packagingIds = await allocatePackagingIds(
          client,
          validated.packaging,
        );
        const defaultUnitIds = resolveDefaultUnitIds(
          validated.packaging,
          packagingIds,
        );
        const result = await client.query<{ id: string }>(
          `insert into catalog_products (
             pharmacy_id, definition_mode,
             medication_trade_name, medication_strength,
             medication_dosage_form, medication_manufacturer,
             general_company, general_sub_brand, general_type_of_use,
             general_property, general_target_audience, general_size,
             display_name, name_template_version, arabic_search_name,
             scientific_name, category, uses_per_day, uses_per_week,
             uses_per_month, food_timing, externally_visible,
             ai_sharing_allowed, manual_state_colour, cold_storage_required,
             count_default_unit_id, purchase_default_unit_id,
             sale_default_unit_id, pricing_method, retail_price_fils,
             wholesale_price_fils, margin_percentage, price_rounding,
             created_by, updated_by
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
             $26, $27, $28, $29, $30, $31, $32, $33, $34, $34
           ) returning id`,
          [
            ...productWriteValues(
              context.pharmacyId,
              input,
              displayName,
              CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
            ),
            defaultUnitIds.count,
            defaultUnitIds.purchase,
            defaultUnitIds.sale,
            ...pricingWriteValues(validated.pricing),
            context.actorId,
          ],
        );
        const productId = result.rows[0]?.id;
        if (productId === undefined) {
          throw new Error("The Catalog Product was not created");
        }
        await replacePackaging(
          client,
          context.pharmacyId,
          productId,
          validated.packaging,
          packagingIds,
        );
        await replaceBarcodes(client, context, productId, input.barcodes);
        const product = await requiredProduct(
          client,
          context.pharmacyId,
          productId,
        );
        return {
          afterState: productAuditState(product),
          response: productView(product),
          targetId: product.id,
        };
      },
    });
  }

  public async edit(
    request: Request,
    productId: string,
    input: ProductEditRequest,
  ): Promise<Product> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    const requestHash = canonicalRequestHash(COMMANDS.edit, {
      input,
      productId,
    });
    return await this.executeCommand({
      commandName: COMMANDS.edit,
      context,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      responseStatus: 200,
      responseSchema: productSchema,
      targetId: productId,
      work: async (client) => {
        const before = await lockProduct(client, context.pharmacyId, productId);
        requireEditable(before, productId, input.expectedRevision);
        const validated = validateCatalogAttributes(input);
        await ensureBarcodesAvailable(
          client,
          context.pharmacyId,
          productId,
          input.barcodes,
        );
        const templateVersion = storedTemplateVersion(
          before!.name_template_version,
        );
        const displayName = generatedName(input.definition, templateVersion);
        const values = productWriteValues(
          context.pharmacyId,
          input,
          displayName,
          templateVersion,
        );
        const packagingIds = await allocatePackagingIds(
          client,
          validated.packaging,
        );
        const defaultUnitIds = resolveDefaultUnitIds(
          validated.packaging,
          packagingIds,
        );
        const updated = await client.query(
          `update catalog_products
           set definition_mode = $2,
               medication_trade_name = $3,
               medication_strength = $4,
               medication_dosage_form = $5,
               medication_manufacturer = $6,
               general_company = $7,
               general_sub_brand = $8,
               general_type_of_use = $9,
               general_property = $10,
               general_target_audience = $11,
               general_size = $12,
               display_name = $13,
               name_template_version = $14,
               arabic_search_name = $15,
               scientific_name = $16,
               category = $17,
               uses_per_day = $18,
               uses_per_week = $19,
               uses_per_month = $20,
               food_timing = $21,
               externally_visible = $22,
               ai_sharing_allowed = $23,
               manual_state_colour = $24,
               cold_storage_required = $25,
               count_default_unit_id = $26,
               purchase_default_unit_id = $27,
               sale_default_unit_id = $28,
               pricing_method = $29,
               retail_price_fils = $30,
               wholesale_price_fils = $31,
               margin_percentage = $32,
               price_rounding = $33,
               updated_by = $34,
               updated_at = statement_timestamp(),
               revision = revision + 1
           where id = $35 and pharmacy_id = $1`,
          [
            ...values,
            defaultUnitIds.count,
            defaultUnitIds.purchase,
            defaultUnitIds.sale,
            ...pricingWriteValues(validated.pricing),
            context.actorId,
            productId,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new Error("The Catalog Product edit was not applied");
        }
        await replacePackaging(
          client,
          context.pharmacyId,
          productId,
          validated.packaging,
          packagingIds,
        );
        await replaceBarcodes(client, context, productId, input.barcodes);
        const after = await requiredProduct(
          client,
          context.pharmacyId,
          productId,
        );
        const modeChanged = before?.definition_mode !== after.definition_mode;
        return {
          afterState: {
            ...productAuditState(after),
            ...(modeChanged
              ? { modeSwitchOutcome: "cleared-abandoned-fields" }
              : {}),
          },
          beforeState: productAuditState(before!),
          response: productView(after),
          targetId: after.id,
        };
      },
    });
  }

  public async archive(
    request: Request,
    productId: string,
    input: ProductArchiveRequest,
  ): Promise<Product> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    const requestHash = canonicalRequestHash(COMMANDS.archive, {
      input,
      productId,
    });
    return await this.executeCommand({
      commandName: COMMANDS.archive,
      context,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      responseStatus: 201,
      responseSchema: productSchema,
      targetId: productId,
      work: async (client) => {
        const before = await lockProduct(client, context.pharmacyId, productId);
        requireEditable(before, productId, input.expectedRevision);
        await client.query(
          `update catalog_products
           set status = 'archived', revision = revision + 1,
               updated_at = statement_timestamp(), updated_by = $3
           where pharmacy_id = $1 and id = $2`,
          [context.pharmacyId, productId, context.actorId],
        );
        const after = await requiredProduct(
          client,
          context.pharmacyId,
          productId,
        );
        return {
          afterState: productAuditState(after),
          beforeState: productAuditState(before!),
          response: productView(after),
          targetId: after.id,
        };
      },
    });
  }

  public async merge(
    request: Request,
    productId: string,
    input: ProductMergeRequest,
  ): Promise<Product> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    const requestHash = canonicalRequestHash(COMMANDS.merge, {
      input,
      productId,
    });
    return await this.executeCommand({
      commandName: COMMANDS.merge,
      context,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      responseStatus: 201,
      responseSchema: productSchema,
      targetId: productId,
      work: async (client) => {
        if (productId === input.survivorProductId) {
          throw new CatalogCommandRejected(
            409,
            "merge-into-self",
            [],
            productId,
          );
        }
        const locked = await lockProducts(client, context.pharmacyId, [
          productId,
          input.survivorProductId,
        ]);
        const before = locked.get(productId);
        requireEditable(before, productId, input.expectedRevision);
        const survivor = locked.get(input.survivorProductId);
        if (survivor === undefined || survivor.status !== "active") {
          throw new CatalogCommandRejected(
            409,
            "merge-survivor-not-mergeable",
            [],
            input.survivorProductId,
          );
        }
        await client.query(
          `update catalog_products
           set status = 'merged', merged_into_product_id = $3,
               revision = revision + 1, updated_at = statement_timestamp(),
               updated_by = $4
           where pharmacy_id = $1 and id = $2`,
          [
            context.pharmacyId,
            productId,
            input.survivorProductId,
            context.actorId,
          ],
        );
        const after = await requiredProduct(
          client,
          context.pharmacyId,
          productId,
        );
        return {
          afterState: productAuditState(after),
          beforeState: productAuditState(before!),
          response: productView(after),
          targetId: after.id,
        };
      },
    });
  }

  public async search(
    request: Request,
    input: ProductSearchRequest,
  ): Promise<ProductSearchResponse> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_SEARCH_PERMISSION,
    );
    const exact = await this.localDatabase.requirePool().query<{
      barcode: string;
      kind: ProductBarcode["kind"];
      product_id: string;
      source: ProductBarcode["source"];
    }>(
      `select product_id, barcode, kind, source
       from catalog_product_barcodes
       where pharmacy_id = $1 and barcode = $2 and removed_at is null
       limit 1`,
      [context.pharmacyId, input.query],
    );
    const barcode = exact.rows[0];
    if (barcode !== undefined) {
      const product = await selectProduct(
        this.localDatabase.requirePool(),
        context.pharmacyId,
        barcode.product_id,
      );
      if (product !== undefined && product.status === "active") {
        return productSearchResponseSchema.parse({
          hasMore: false,
          query: input.query,
          resultCount: 1,
          results: [
            {
              matchedBarcode: {
                kind: barcode.kind,
                source: barcode.source,
                value: barcode.barcode,
              },
              matchedField: "barcode",
              product: productView(product),
            },
          ],
        });
      }
    }

    const candidates = await this.localDatabase.requirePool().query<{
      arabic_search_name: string | null;
      display_name: string;
      id: string;
    }>(
      `select id, display_name, arabic_search_name
       from catalog_products
       where pharmacy_id = $1 and status = 'active'
       order by created_at, id`,
      [context.pharmacyId],
    );
    const matches: {
      readonly id: string;
      readonly matchedField: "arabic-name" | "english-name";
    }[] = [];
    for (const candidate of candidates.rows) {
      if (matchesOrderedProductName(candidate.display_name, input.query)) {
        matches.push({ id: candidate.id, matchedField: "english-name" });
        continue;
      }
      if (
        candidate.arabic_search_name !== null &&
        matchesOrderedProductName(candidate.arabic_search_name, input.query)
      ) {
        matches.push({ id: candidate.id, matchedField: "arabic-name" });
      }
    }
    const limit = Number(input.limit ?? "50");
    const selected = matches.slice(0, limit);
    const productRows =
      selected.length === 0
        ? []
        : (
            await this.localDatabase.requirePool().query<ProductRow>(
              `${PRODUCT_SELECT}
               where product_row.pharmacy_id = $1
                 and product_row.id = any($2::uuid[])`,
              [context.pharmacyId, selected.map(({ id }) => id)],
            )
          ).rows;
    const productsById = new Map(
      productRows.map((row) => [row.id, productView(row)]),
    );
    const results = selected.map((match) => {
      const product = productsById.get(match.id);
      if (product === undefined) {
        throw new Error("A Catalog search candidate disappeared");
      }
      return {
        matchedBarcode: null,
        matchedField: match.matchedField,
        product,
      };
    });
    return productSearchResponseSchema.parse({
      hasMore: matches.length > results.length,
      query: input.query,
      resultCount: matches.length,
      results,
    });
  }

  public async addBarcode(
    request: Request,
    productId: string,
    input: ProductBarcodeAddRequest,
  ): Promise<Product> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.addBarcode,
      context,
      idempotencyKey: input.idempotencyKey,
      requestHash: canonicalRequestHash(COMMANDS.addBarcode, {
        input,
        productId,
      }),
      responseSchema: productSchema,
      responseStatus: 201,
      targetId: productId,
      work: async (client) => {
        const before = await lockProduct(client, context.pharmacyId, productId);
        requireEditable(before, productId, input.expectedRevision);
        if (
          before.barcodes.some(
            (candidate) => candidate.value === input.barcode.value,
          )
        ) {
          throw new CatalogCommandRejected(
            409,
            "barcode-already-present",
            [],
            productId,
          );
        }
        await ensureBarcodesAvailable(client, context.pharmacyId, productId, [
          input.barcode,
        ]);
        await insertBarcode(
          client,
          context,
          productId,
          input.barcode,
          "provided",
          before.barcodes.length,
        );
        await touchProduct(client, context, productId);
        const after = await requiredProduct(
          client,
          context.pharmacyId,
          productId,
        );
        return {
          afterState: productAuditState(after),
          beforeState: productAuditState(before),
          response: productView(after),
          targetId: productId,
        };
      },
    });
  }

  public async suggestBarcode(
    request: Request,
    productId: string,
    input: ProductBarcodeSuggestRequest,
  ): Promise<ProductBarcodeSuggestionResponse> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.suggestBarcode,
      context,
      idempotencyKey: input.idempotencyKey,
      requestHash: canonicalRequestHash(COMMANDS.suggestBarcode, {
        input,
        productId,
      }),
      responseSchema: productBarcodeSuggestionResponseSchema,
      responseStatus: 201,
      targetId: productId,
      work: async (client) => {
        const before = await lockProduct(client, context.pharmacyId, productId);
        requireEditable(before, productId, input.expectedRevision);
        if (before.barcodes.length > 0) {
          throw new CatalogCommandRejected(
            409,
            "barcode-already-present",
            [],
            productId,
          );
        }
        const value = await allocateInternalBarcode(client, context.pharmacyId);
        await insertBarcode(
          client,
          context,
          productId,
          { kind: input.kind, value },
          "breev-internal",
          0,
        );
        await touchProduct(client, context, productId);
        const after = await requiredProduct(
          client,
          context.pharmacyId,
          productId,
        );
        return {
          afterState: {
            ...productAuditState(after),
            barcodeSource: "breev-internal",
          },
          beforeState: productAuditState(before),
          response: productBarcodeSuggestionResponseSchema.parse({
            barcode: after.barcodes[0],
            product: productView(after),
          }),
          targetId: productId,
        };
      },
    });
  }

  public async printBarcode(
    request: Request,
    productId: string,
    input: ProductBarcodePrintRequest,
  ): Promise<BarcodePrintHandoff> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.printBarcode,
      context,
      idempotencyKey: input.idempotencyKey,
      requestHash: canonicalRequestHash(COMMANDS.printBarcode, {
        input,
        productId,
      }),
      responseSchema: barcodePrintHandoffSchema,
      responseStatus: 201,
      targetId: productId,
      work: async (client) => {
        const product = await lockProduct(
          client,
          context.pharmacyId,
          productId,
        );
        if (product === undefined || product.status !== "active") {
          throw new CatalogCommandRejected(
            404,
            "product-not-found",
            [],
            productId,
          );
        }
        const barcode = product.barcodes.find(
          (candidate) => candidate.value === input.barcode,
        );
        if (barcode === undefined) {
          throw new CatalogCommandRejected(
            404,
            "barcode-not-found",
            [],
            productId,
          );
        }
        const job = await client.query<{ id: string }>("select uuidv7() as id");
        const response = barcodePrintHandoffSchema.parse({
          barcode,
          displayName: product.display_name,
          jobId: job.rows[0]?.id,
          locale: input.locale,
          quantity: input.quantity,
        });
        return {
          afterState: { barcode: barcode.value, quantity: input.quantity },
          response,
          targetId: productId,
        };
      },
    });
  }

  public async openMatchingBatch(
    request: Request,
    input: CatalogMatchingBatchOpenRequest,
  ): Promise<CatalogMatchingBatch> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.matchingOpen,
      context,
      idempotencyKey: input.idempotencyKey,
      requestHash: canonicalRequestHash(COMMANDS.matchingOpen, input),
      responseSchema: catalogMatchingBatchSchema,
      responseStatus: 201,
      work: async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, $2::bigint))",
          [`${context.pharmacyId}:catalog-matching`, MATCHING_LOCK_NAMESPACE],
        );
        const businessDate = await currentBusinessDate(
          client,
          context.pharmacyId,
        );
        const opened = await client.query(
          `insert into catalog_matching_batches (pharmacy_id, business_date, opened_by)
           values ($1, $2, $3) on conflict do nothing`,
          [context.pharmacyId, businessDate, context.actorId],
        );
        if (opened.rowCount === 1) {
          await fillMatchingBatch(client, context, businessDate);
        }
        const response = await readMatchingBatch(
          client,
          context.pharmacyId,
          businessDate,
        );
        return {
          afterState: {
            businessDate,
            suggestionCount: response.suggestions.length,
          },
          response,
        };
      },
    });
  }

  public async approveMatchingSuggestion(
    request: Request,
    suggestionId: string,
    input: CatalogMatchingApprovalRequest,
  ): Promise<Product> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    return await this.executeCommand({
      commandName: COMMANDS.matchingApprove,
      context,
      idempotencyKey: input.idempotencyKey,
      requestHash: canonicalRequestHash(COMMANDS.matchingApprove, {
        input,
        suggestionId,
      }),
      responseSchema: productSchema,
      responseStatus: 201,
      targetId: suggestionId,
      work: async (client) => {
        const suggestion = await client.query<{
          product_id: string;
          proposed_barcode: string;
        }>(
          `select product_id, proposed_barcode from catalog_matching_suggestions
           where pharmacy_id = $1 and id = $2 and approved_at is null for update`,
          [context.pharmacyId, suggestionId],
        );
        const row = suggestion.rows[0];
        if (row === undefined)
          throw new CatalogCommandRejected(
            404,
            "matching-suggestion-not-found",
            [],
            suggestionId,
          );
        const before = await lockProduct(
          client,
          context.pharmacyId,
          row.product_id,
        );
        requireEditable(before, row.product_id, input.expectedRevision);
        if (before.barcodes.length > 0)
          throw new CatalogCommandRejected(
            409,
            "barcode-already-present",
            [],
            row.product_id,
          );
        await ensureBarcodesAvailable(
          client,
          context.pharmacyId,
          row.product_id,
          [{ kind: "product", value: row.proposed_barcode }],
        );
        await insertBarcode(
          client,
          context,
          row.product_id,
          { kind: "product", value: row.proposed_barcode },
          "breev-internal",
          0,
        );
        await touchProduct(client, context, row.product_id);
        await client.query(
          `update catalog_matching_suggestions set approved_at = statement_timestamp(), approved_by = $3 where pharmacy_id = $1 and id = $2`,
          [context.pharmacyId, suggestionId, context.actorId],
        );
        const after = await requiredProduct(
          client,
          context.pharmacyId,
          row.product_id,
        );
        return {
          afterState: { ...productAuditState(after), suggestionId },
          beforeState: productAuditState(before),
          response: productView(after),
          targetId: row.product_id,
        };
      },
    });
  }

  public async rejectInvalidBody(
    request: Request,
    action: string,
    fieldErrors: readonly CatalogFieldError[],
    targetId?: string,
    permission:
      | typeof CATALOG_PERMISSION
      | typeof CATALOG_SEARCH_PERMISSION = CATALOG_PERMISSION,
  ): Promise<never> {
    const context = await this.identity.requirePermission(request, permission);
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      const requestId = await writePostingAudit(client, {
        action,
        actorUserId: context.actorId,
        afterState: { fieldErrorCount: fieldErrors.length },
        device: context,
        identitySessionId: context.sessionId,
        outcome: "body-invalid",
        pharmacyId: context.pharmacyId,
        ...(targetId === undefined ? {} : { targetId }),
      });
      await client.query("commit");
      throw catalogDenied(400, "body-invalid", requestId, fieldErrors);
    } catch (error) {
      if (!(error instanceof CatalogDenied)) {
        await client.query("rollback").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async rejectMissingProduct(
    request: Request,
    action: string,
    targetId: string | undefined,
  ): Promise<never> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
    throw await this.readDenial(context, action, "product-not-found", targetId);
  }

  private async executeCommand<T>(input: CommandExecution<T>): Promise<T> {
    return await runWholeCommandWithRetry(
      async () => await this.executeCommandAttempt(input),
    );
  }

  private async executeCommandAttempt<T>(
    input: CommandExecution<T>,
  ): Promise<T> {
    const client = await this.localDatabase.requirePool().connect();
    let transactionOpen = false;
    try {
      await client.query("begin");
      transactionOpen = true;
      await this.identity.revalidateCatalogManagement(client, input.context);
      let replay: PostingCommandReplay | undefined;
      try {
        replay = await beginPostingIdempotency(client, {
          commandName: input.commandName,
          idempotencyKey: input.idempotencyKey,
          pharmacyId: input.context.pharmacyId,
          requestHash: input.requestHash,
        });
      } catch (error) {
        if (!(error instanceof PostingIdempotencyConflict)) {
          throw error;
        }
        const requestId = await writePostingAudit(client, {
          action: input.commandName,
          actorUserId: input.context.actorId,
          correlationId: input.idempotencyKey,
          device: input.context,
          identitySessionId: input.context.sessionId,
          outcome: "idempotency-conflict",
          pharmacyId: input.context.pharmacyId,
          ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
        });
        await client.query("commit");
        transactionOpen = false;
        throw catalogDenied(409, "idempotency-conflict", requestId);
      }

      if (replay !== undefined) {
        await client.query("commit");
        transactionOpen = false;
        return replayCatalogOutcome(replay, input.responseSchema);
      }

      let success: CommandSuccess<T>;
      try {
        success = await input.work(client);
      } catch (error) {
        if (!(error instanceof CatalogCommandRejected)) {
          throw error;
        }
        const requestId = await writePostingAudit(client, {
          action: input.commandName,
          actorUserId: input.context.actorId,
          correlationId: input.idempotencyKey,
          device: input.context,
          identitySessionId: input.context.sessionId,
          outcome: error.code,
          pharmacyId: input.context.pharmacyId,
          ...(error.targetId === undefined && input.targetId === undefined
            ? {}
            : { targetId: error.targetId ?? input.targetId }),
        });
        const denied = catalogDenied(
          error.statusCode,
          error.code,
          requestId,
          error.fieldErrors,
        );
        await recordPostingResult(client, {
          actorUserId: input.context.actorId,
          commandName: input.commandName,
          device: input.context,
          idempotencyKey: input.idempotencyKey,
          identitySessionId: input.context.sessionId,
          pharmacyId: input.context.pharmacyId,
          requestHash: input.requestHash,
          responseBody: denied.denial,
          responseStatus: error.statusCode,
        });
        await client.query("commit");
        transactionOpen = false;
        throw denied;
      }

      await writePostingAudit(client, {
        action: input.commandName,
        actorUserId: input.context.actorId,
        afterState: success.afterState,
        ...(success.beforeState === undefined
          ? {}
          : { beforeState: success.beforeState }),
        correlationId: input.idempotencyKey,
        device: input.context,
        identitySessionId: input.context.sessionId,
        outcome: "committed",
        pharmacyId: input.context.pharmacyId,
        ...(success.targetId === undefined && input.targetId === undefined
          ? {}
          : { targetId: success.targetId ?? input.targetId }),
      });
      await recordPostingResult(client, {
        actorUserId: input.context.actorId,
        commandName: input.commandName,
        device: input.context,
        idempotencyKey: input.idempotencyKey,
        identitySessionId: input.context.sessionId,
        pharmacyId: input.context.pharmacyId,
        requestHash: input.requestHash,
        responseBody: success.response,
        responseStatus: input.responseStatus,
      });
      await client.query("commit");
      transactionOpen = false;
      return success.response;
    } catch (error) {
      if (transactionOpen) {
        await client.query("rollback").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async readDenial(
    context: IdentityExecutionContext,
    action: string,
    code: "product-not-found",
    targetId: string | undefined,
  ): Promise<CatalogDenied> {
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      const requestId = await writePostingAudit(client, {
        action,
        actorUserId: context.actorId,
        device: context,
        identitySessionId: context.sessionId,
        outcome: code,
        pharmacyId: context.pharmacyId,
        ...(targetId === undefined ? {} : { targetId }),
      });
      await client.query("commit");
      return catalogDenied(404, code, requestId);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function productWriteValues(
  pharmacyId: string,
  input: ProductCreateRequest | ProductEditRequest,
  displayName: string,
  templateVersion: ProductNameTemplateVersion,
): readonly unknown[] {
  const definition = definitionColumns(input.definition);
  return [
    pharmacyId,
    input.definition.mode,
    definition.medicationTradeName,
    definition.medicationStrength,
    definition.medicationDosageForm,
    definition.medicationManufacturer,
    definition.generalCompany,
    definition.generalSubBrand,
    definition.generalTypeOfUse,
    definition.generalProperty,
    definition.generalTargetAudience,
    definition.generalSize,
    displayName,
    templateVersion,
    input.arabicSearchName,
    input.scientificName,
    input.category,
    input.instructions.usesPerDay,
    input.instructions.usesPerWeek,
    input.instructions.usesPerMonth,
    input.instructions.foodTiming,
    input.sharing.externallyVisible,
    input.sharing.aiSharingAllowed,
    input.stateColours.manual,
    input.stateColours.coldStorageRequired,
  ];
}

/**
 * The packaging and pricing a command may persist, after the pure Catalog
 * modules have read the request back rather than trusting that the contract
 * already checked it. The pricing here is the resolved read-back shape: a By
 * Percentage request's `costFils` has done its work by this point and is not
 * among the values any statement below writes.
 */
interface ValidatedAttributes {
  readonly packaging: Packaging;
  readonly pricing: CatalogPricing;
}

function validateCatalogAttributes(
  input: ProductCreateRequest | ProductEditRequest,
): ValidatedAttributes {
  const packaging = definePackaging(input.packaging);
  if (!packaging.ok) {
    throw new CatalogCommandRejected(
      400,
      "body-invalid",
      packaging.problems.map((problem) =>
        packagingFieldError(input.packaging, problem),
      ),
    );
  }
  const pricing = resolveCatalogPricing(input.pricing);
  if (!pricing.ok) {
    throw new CatalogCommandRejected(400, "body-invalid", [
      { code: "invalid", path: pricingFieldPath(pricing.problem.code) },
    ]);
  }
  return { packaging: packaging.packaging, pricing: pricing.pricing };
}

/**
 * Points a packaging refusal at the field the pharmacist is standing in, so the
 * screen keeps the value and the focus instead of clearing the form.
 */
function packagingFieldError(
  definition: ProductPackaging,
  problem: PackagingProblem,
): CatalogFieldError {
  const packageIndex = definition.packageUnits.findIndex(
    (unit) => unit.name === problem.unitName,
  );
  if (problem.code === "package-ratio-invalid") {
    return {
      code: "invalid",
      path: ["packaging", "packageUnits", packageIndex, "baseUnitsPerPackage"],
    };
  }
  if (problem.code === "unknown-package-unit") {
    const unitInterface = UNIT_INTERFACES.find((candidate) => {
      const unit = definition.defaultUnits[candidate];
      return (
        unit.kind === "package-unit" &&
        unit.packageUnitName === problem.unitName
      );
    });
    return {
      code: "invalid",
      path:
        unitInterface === undefined
          ? ["packaging", "defaultUnits"]
          : ["packaging", "defaultUnits", unitInterface, "packageUnitName"],
    };
  }
  if (problem.unitName === definition.inventoryUnitName) {
    return { code: "invalid", path: ["packaging", "inventoryUnitName"] };
  }
  if (packageIndex >= 0) {
    return {
      code: "invalid",
      path: ["packaging", "packageUnits", packageIndex, "name"],
    };
  }
  if (problem.unitName === definition.thirdUnit?.name) {
    return { code: "invalid", path: ["packaging", "thirdUnit", "name"] };
  }
  return { code: "invalid", path: ["packaging"] };
}

function pricingFieldPath(
  code: CatalogPricingProblemCode,
): (string | number)[] {
  switch (code) {
    case "cost-invalid":
      return ["pricing", "costFils"];
    case "margin-invalid":
      return ["pricing", "marginPercentage"];
    case "retail-price-invalid":
      return ["pricing", "retailPriceFils"];
    case "rounding-invalid":
      return ["pricing", "rounding"];
    case "wholesale-price-invalid":
      return ["pricing", "wholesalePriceFils"];
  }
}

/**
 * The five pricing columns, in the order both the insert and the update name
 * them. By Price carries no percentage and no rounding setting, and writing
 * nulls for them is what keeps `catalog_products_pricing_state` satisfied
 * rather than a second statement that could be forgotten.
 */
function pricingWriteValues(pricing: CatalogPricing): readonly unknown[] {
  return pricing.method === "by-percentage"
    ? [
        pricing.method,
        pricing.retailPriceFils,
        pricing.wholesalePriceFils,
        pricing.marginPercentage,
        pricing.rounding,
      ]
    : [
        pricing.method,
        pricing.retailPriceFils,
        pricing.wholesalePriceFils,
        null,
        null,
      ];
}

/**
 * The identity of every unit row this command is about to write, keyed the way
 * a default unit references one.
 *
 * The ids are minted by PostgreSQL rather than by Node, so they satisfy the
 * `uuidv7` check the table carries. They are minted before the Product row is
 * inserted because `catalog_products` names its three default units as columns,
 * and its foreign keys to them are deferred exactly so the two inserts can
 * happen in this order inside one transaction.
 */
interface PackagingIds {
  readonly inventory: string;
  readonly packages: ReadonlyMap<string, string>;
}

async function allocatePackagingIds(
  client: PoolClient,
  packaging: Packaging,
): Promise<PackagingIds> {
  const wanted = packaging.packageUnits.length + 1;
  const result = await client.query<{ id: string }>(
    "select uuidv7() as id from generate_series(1, $1::int)",
    [wanted],
  );
  if (result.rows.length !== wanted) {
    throw new Error("The Catalog Product units were not allocated identities");
  }
  const ids = result.rows.map((row) => row.id);
  return {
    inventory: ids[0]!,
    packages: new Map(
      packaging.packageUnits.map((unit, index) => [unit.name, ids[index + 1]!]),
    ),
  };
}

function resolveDefaultUnitIds(
  packaging: Packaging,
  ids: PackagingIds,
): Readonly<Record<UnitInterface, string>> {
  const resolve = (unitInterface: UnitInterface): string => {
    const unit = defaultUnitFor(packaging, unitInterface);
    if (unit.kind === "inventory-unit") {
      return ids.inventory;
    }
    const id = ids.packages.get(unit.packageUnitName);
    if (id === undefined) {
      // definePackaging already refused a default that names no package, so
      // reaching here means the two disagree rather than that the request did.
      throw new Error("A Catalog default unit names no unit of this Product");
    }
    return id;
  };
  return {
    count: resolve("count"),
    purchase: resolve("purchase"),
    sale: resolve("sale"),
  };
}

/**
 * Replaces this Product's unit rows with the ones the command carries.
 *
 * An edit deletes the old rows and inserts the new ones in the same
 * transaction as the `catalog_products` update that points at the new ones.
 * That is safe only because the three default-unit foreign keys are
 * `deferrable initially deferred`: the rows a live Product references are gone
 * for the middle of this function, and the constraint is checked once at
 * commit, against the finished state. Create takes the same path with nothing
 * to delete, so there is one way packaging reaches the database.
 *
 * The Third Unit lives in its own table with no ratio column and no unit id,
 * which is why nothing here can offer it to a conversion or to a default.
 */
async function replacePackaging(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
  packaging: Packaging,
  ids: PackagingIds,
): Promise<void> {
  await client.query(
    "delete from catalog_product_units where pharmacy_id = $1 and product_id = $2",
    [pharmacyId, productId],
  );
  await client.query(
    `delete from catalog_product_third_units
     where pharmacy_id = $1 and product_id = $2`,
    [pharmacyId, productId],
  );
  await client.query(
    `insert into catalog_product_units (
       id, pharmacy_id, product_id, kind, name, ordinal, base_units_per_package
     ) values ($1, $2, $3, 'inventory', $4, 0, null)`,
    [ids.inventory, pharmacyId, productId, packaging.inventoryUnitName],
  );
  for (const [index, unit] of packaging.packageUnits.entries()) {
    await client.query(
      `insert into catalog_product_units (
         id, pharmacy_id, product_id, kind, name, ordinal,
         base_units_per_package
       ) values ($1, $2, $3, 'package', $4, $5, $6)`,
      [
        ids.packages.get(unit.name),
        pharmacyId,
        productId,
        unit.name,
        index + 1,
        unit.baseUnitsPerPackage.toString(),
      ],
    );
  }
  if (packaging.thirdUnitName !== null) {
    await client.query(
      `insert into catalog_product_third_units (pharmacy_id, product_id, name)
       values ($1, $2, $3)`,
      [pharmacyId, productId, packaging.thirdUnitName],
    );
  }
}

function definitionColumns(definition: ProductDefinition): {
  readonly generalCompany: string | null;
  readonly generalProperty: string | null;
  readonly generalSize: string | null;
  readonly generalSubBrand: string | null;
  readonly generalTargetAudience: string | null;
  readonly generalTypeOfUse: string | null;
  readonly medicationDosageForm: string | null;
  readonly medicationManufacturer: string | null;
  readonly medicationStrength: string | null;
  readonly medicationTradeName: string | null;
} {
  if (definition.mode === "medication") {
    return {
      generalCompany: null,
      generalProperty: null,
      generalSize: null,
      generalSubBrand: null,
      generalTargetAudience: null,
      generalTypeOfUse: null,
      medicationDosageForm: definition.fields.dosageForm,
      medicationManufacturer: definition.fields.manufacturer,
      medicationStrength: definition.fields.strength,
      medicationTradeName: definition.fields.tradeName,
    };
  }
  return {
    generalCompany: definition.fields.company,
    generalProperty: definition.fields.property,
    generalSize: definition.fields.size,
    generalSubBrand: definition.fields.subBrand,
    generalTargetAudience: definition.fields.targetAudience,
    generalTypeOfUse: definition.fields.typeOfUse,
    medicationDosageForm: null,
    medicationManufacturer: null,
    medicationStrength: null,
    medicationTradeName: null,
  };
}

function generatedName(
  definition: ProductDefinition,
  templateVersion: ProductNameTemplateVersion,
): string {
  return definition.mode === "medication"
    ? generateDisplayName(definition.mode, definition.fields, templateVersion)
    : generateDisplayName(definition.mode, definition.fields, templateVersion);
}

function storedTemplateVersion(value: number): ProductNameTemplateVersion {
  if (!isProductNameTemplateVersion(value)) {
    throw new Error("The Catalog Product has an unsupported name template");
  }
  return value;
}

function productView(row: ProductRow): Product {
  const definition: ProductDefinition =
    row.definition_mode === "medication"
      ? {
          fields: {
            dosageForm: row.medication_dosage_form,
            manufacturer: row.medication_manufacturer,
            strength: row.medication_strength,
            tradeName: requiredText(row.medication_trade_name),
          },
          mode: "medication",
        }
      : {
          fields: {
            company: requiredText(row.general_company),
            property: row.general_property,
            size: row.general_size,
            subBrand: row.general_sub_brand,
            targetAudience: row.general_target_audience,
            typeOfUse: row.general_type_of_use,
          },
          mode: "general-item",
        };
  return productSchema.parse({
    arabicSearchName: row.arabic_search_name,
    barcodes: row.barcodes,
    category: row.category,
    definition,
    displayName: row.display_name,
    id: row.id,
    instructions: {
      foodTiming: row.food_timing,
      usesPerDay: row.uses_per_day,
      usesPerMonth: row.uses_per_month,
      usesPerWeek: row.uses_per_week,
    },
    mergedIntoProductId: row.merged_into_product_id,
    nameTemplateVersion: row.name_template_version,
    packaging: {
      defaultUnits: {
        count: unitReference(row.count_default_kind, row.count_default_name),
        purchase: unitReference(
          row.purchase_default_kind,
          row.purchase_default_name,
        ),
        sale: unitReference(row.sale_default_kind, row.sale_default_name),
      },
      inventoryUnitName: row.inventory_unit_name,
      packageUnits: row.package_units.map((unit) => ({
        baseUnitsPerPackage: unit.baseUnitsPerPackage,
        name: unit.name,
      })),
      thirdUnit:
        row.third_unit_name === null ? null : { name: row.third_unit_name },
    },
    pricing: pricingView(row),
    revision: row.revision,
    scientificName: row.scientific_name,
    sharing: {
      aiSharingAllowed: row.ai_sharing_allowed,
      externallyVisible: row.externally_visible,
    },
    stateColours: {
      coldStorageRequired: row.cold_storage_required,
      manual: row.manual_state_colour,
    },
    status: row.status,
  });
}

function unitReference(
  kind: "inventory" | "package",
  name: string,
): InventoryCapableUnit {
  return kind === "inventory"
    ? { kind: "inventory-unit" }
    : { kind: "package-unit", packageUnitName: name };
}

/**
 * Pricing as it is read back. By Percentage returns the retail price the server
 * calculated and stored, never the cost it was calculated from: the cost is
 * transient calculation input, so there is no column holding it and no shape
 * here that could carry it back.
 */
function pricingView(row: ProductRow): ProductPricing {
  if (row.pricing_method === "by-percentage") {
    if (row.margin_percentage === null || row.price_rounding === null) {
      throw new Error("A By Percentage Catalog Product is missing its pricing");
    }
    return {
      marginPercentage: row.margin_percentage,
      method: "by-percentage",
      retailPriceFils: row.retail_price_fils,
      rounding: row.price_rounding,
      wholesalePriceFils: row.wholesale_price_fils,
    };
  }
  return {
    method: "by-price",
    retailPriceFils: row.retail_price_fils,
    wholesalePriceFils: row.wholesale_price_fils,
  };
}

function requiredText(value: string | null): string {
  if (value === null) {
    throw new Error("A Catalog Product is missing its required naming field");
  }
  return value;
}

function productAuditState(
  row: ProductRow,
): Record<string, number | string | null> {
  return {
    definitionMode: row.definition_mode,
    mergedIntoProductId: row.merged_into_product_id,
    nameTemplateVersion: row.name_template_version,
    revision: row.revision,
    status: row.status,
  };
}

function requireEditable(
  product: ProductRow | undefined,
  productId: string,
  expectedRevision: string,
): asserts product is ProductRow {
  if (product === undefined) {
    throw new CatalogCommandRejected(404, "product-not-found", [], productId);
  }
  if (product.status === "archived") {
    throw new CatalogCommandRejected(409, "product-archived", [], productId);
  }
  if (product.status === "merged") {
    throw new CatalogCommandRejected(409, "product-merged", [], productId);
  }
  if (product.revision !== expectedRevision) {
    throw new CatalogCommandRejected(409, "version-conflict", [], productId);
  }
}

async function ensureBarcodesAvailable(
  client: PoolClient,
  pharmacyId: string,
  productId: string | undefined,
  barcodes: readonly ProductBarcodeInput[],
): Promise<void> {
  const values = barcodes.map((barcode) => barcode.value);
  for (const barcode of [...values].sort()) {
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, $2::bigint))",
      [`${pharmacyId}:catalog-barcode:${barcode}`, BARCODE_LOCK_NAMESPACE],
    );
  }
  if (barcodes.length === 0) {
    return;
  }
  const conflict = await client.query<{ barcode: string }>(
    `select barcode
     from catalog_product_barcodes
     where pharmacy_id = $1
       and barcode = any($2::text[])
       and removed_at is null
       and ($3::uuid is null or product_id <> $3::uuid)
     order by barcode
     limit 1`,
    [pharmacyId, values, productId ?? null],
  );
  const conflictingBarcode = conflict.rows[0]?.barcode;
  if (conflictingBarcode !== undefined) {
    throw new CatalogCommandRejected(400, "body-invalid", [
      {
        code: "invalid",
        path: ["barcodes", values.indexOf(conflictingBarcode), "value"],
      },
    ]);
  }
}

async function replaceBarcodes(
  client: PoolClient,
  context: IdentityExecutionContext,
  productId: string,
  barcodes: readonly ProductBarcodeInput[],
): Promise<void> {
  await client.query(
    `update catalog_product_barcodes
     set removed_at = statement_timestamp(), removed_by = $3
     where pharmacy_id = $1 and product_id = $2 and removed_at is null`,
    [context.pharmacyId, productId, context.actorId],
  );
  for (const [ordinal, barcode] of barcodes.entries()) {
    await client.query(
      `insert into catalog_product_barcodes (
         pharmacy_id, product_id, barcode, kind, source, ordinal, recorded_by
       ) values ($1, $2, $3, $4, 'provided', $5, $6)
       on conflict (product_id, barcode) do update
       set ordinal = excluded.ordinal,
           kind = excluded.kind,
           removed_at = null,
           removed_by = null`,
      [
        context.pharmacyId,
        productId,
        barcode.value,
        barcode.kind,
        ordinal,
        context.actorId,
      ],
    );
  }
}

async function insertBarcode(
  client: PoolClient,
  context: IdentityExecutionContext,
  productId: string,
  barcode: ProductBarcodeInput,
  source: ProductBarcode["source"],
  ordinal: number,
): Promise<void> {
  await client.query(
    `insert into catalog_product_barcodes (
       pharmacy_id, product_id, barcode, kind, source, ordinal, recorded_by
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      context.pharmacyId,
      productId,
      barcode.value,
      barcode.kind,
      source,
      ordinal,
      context.actorId,
    ],
  );
}

async function touchProduct(
  client: PoolClient,
  context: IdentityExecutionContext,
  productId: string,
): Promise<void> {
  await client.query(
    `update catalog_products
     set revision = revision + 1, updated_at = statement_timestamp(),
         updated_by = $3
     where pharmacy_id = $1 and id = $2`,
    [context.pharmacyId, productId, context.actorId],
  );
}

async function allocateInternalBarcode(
  client: PoolClient,
  pharmacyId: string,
): Promise<string> {
  for (;;) {
    const allocated = await client.query<{ value: string }>(
      `insert into catalog_internal_barcode_sequences (pharmacy_id, next_value)
       values ($1, 2)
       on conflict (pharmacy_id) do update
       set next_value = catalog_internal_barcode_sequences.next_value + 1
       returning (next_value - 1)::text as value`,
      [pharmacyId],
    );
    const sequence = allocated.rows[0]?.value;
    if (sequence === undefined) {
      throw new Error("The internal barcode sequence did not advance");
    }
    const value = `BRV-${sequence.padStart(12, "0")}`;
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, $2::bigint))",
      [`${pharmacyId}:catalog-barcode:${value}`, BARCODE_LOCK_NAMESPACE],
    );
    const collision = await client.query(
      `select 1
       from catalog_product_barcodes
       where pharmacy_id = $1 and barcode = $2 and removed_at is null
       union all
       select 1
       from catalog_matching_suggestions
       where pharmacy_id = $1 and proposed_barcode = $2
       limit 1`,
      [pharmacyId, value],
    );
    if (collision.rowCount === 0) return value;
  }
}

async function currentBusinessDate(
  client: PoolClient,
  pharmacyId: string,
): Promise<string> {
  const result = await client.query<{ business_date: string }>(
    `select (statement_timestamp() at time zone business_time_zone)::date::text
       as business_date
     from pharmacies where id = $1`,
    [pharmacyId],
  );
  const value = result.rows[0]?.business_date;
  if (value === undefined)
    throw new Error("The pharmacy business date is unavailable");
  return value;
}

async function fillMatchingBatch(
  client: PoolClient,
  context: IdentityExecutionContext,
  businessDate: string,
): Promise<void> {
  const existing = await client.query<{ count: string }>(
    `select count(*)::text as count
     from catalog_matching_suggestions
     where pharmacy_id = $1 and approved_at is null`,
    [context.pharmacyId],
  );
  const remaining = Math.max(0, 10 - Number(existing.rows[0]?.count ?? "0"));
  if (remaining === 0) return;
  const products = await client.query<{ id: string }>(
    `select product_row.id
     from catalog_products product_row
     where product_row.pharmacy_id = $1
       and product_row.status = 'active'
       and not exists (
         select 1 from catalog_product_barcodes barcode_row
         where barcode_row.pharmacy_id = product_row.pharmacy_id
           and barcode_row.product_id = product_row.id
           and barcode_row.removed_at is null
       )
       and not exists (
         select 1 from catalog_matching_suggestions suggestion_row
         where suggestion_row.pharmacy_id = product_row.pharmacy_id
           and suggestion_row.product_id = product_row.id
       )
     order by product_row.created_at, product_row.id
     limit $2
     for update of product_row skip locked`,
    [context.pharmacyId, remaining],
  );
  for (const product of products.rows) {
    const proposedBarcode = await allocateInternalBarcode(
      client,
      context.pharmacyId,
    );
    await client.query(
      `insert into catalog_matching_suggestions (
         pharmacy_id, product_id, proposed_barcode,
         first_offered_business_date
       ) values ($1, $2, $3, $4)`,
      [context.pharmacyId, product.id, proposedBarcode, businessDate],
    );
  }
}

async function readMatchingBatch(
  client: PoolClient,
  pharmacyId: string,
  businessDate: string,
): Promise<CatalogMatchingBatch> {
  const rows = await client.query<{
    first_offered_business_date: string;
    id: string;
    product_id: string;
    proposed_barcode: string;
  }>(
    `select id, product_id, proposed_barcode,
            first_offered_business_date::text
     from catalog_matching_suggestions
     where pharmacy_id = $1 and approved_at is null
     order by first_offered_business_date, id
     limit 10`,
    [pharmacyId],
  );
  const suggestions = [];
  for (const row of rows.rows) {
    const product = await requiredProduct(client, pharmacyId, row.product_id);
    suggestions.push({
      firstOfferedBusinessDate: row.first_offered_business_date,
      id: row.id,
      product: productView(product),
      proposedBarcode: {
        kind: "product",
        source: "breev-internal",
        value: row.proposed_barcode,
      },
    });
  }
  return catalogMatchingBatchSchema.parse({ businessDate, suggestions });
}

async function lockProduct(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
): Promise<ProductRow | undefined> {
  const result = await client.query<ProductRow>(
    `${PRODUCT_SELECT}
   where product_row.pharmacy_id = $1 and product_row.id = $2
   for update of product_row`,
    [pharmacyId, productId],
  );
  return result.rows[0];
}

async function lockProducts(
  client: PoolClient,
  pharmacyId: string,
  productIds: readonly string[],
): Promise<Map<string, ProductRow>> {
  const result = await client.query<ProductRow>(
    `${PRODUCT_SELECT}
   where product_row.pharmacy_id = $1
     and product_row.id = any($2::uuid[])
   order by product_row.id
   for update of product_row`,
    [pharmacyId, [...productIds].sort()],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function requiredProduct(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
): Promise<ProductRow> {
  const product = await selectProduct(client, pharmacyId, productId);
  if (product === undefined) {
    throw new Error("The Catalog Product disappeared inside its transaction");
  }
  return product;
}

interface ProductQueryable {
  query<R extends object>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: R[] }>;
}

async function selectProduct(
  queryable: ProductQueryable,
  pharmacyId: string,
  productId: string,
): Promise<ProductRow | undefined> {
  const result = await queryable.query<ProductRow>(
    `${PRODUCT_SELECT}
   where product_row.pharmacy_id = $1 and product_row.id = $2`,
    [pharmacyId, productId],
  );
  return result.rows[0];
}

function catalogDenied(
  statusCode: 400 | 404 | 409,
  code: CatalogDenialCode,
  requestId: string,
  fieldErrors: readonly CatalogFieldError[] = [],
): CatalogDenied {
  return new CatalogDenied(
    statusCode,
    catalogDenialSchema.parse({
      code,
      fieldErrors,
      requestId,
      status: "denied",
    }),
  );
}

function replayCatalogOutcome<T>(
  replay: PostingCommandReplay,
  schema: { parse(value: unknown): T },
): T {
  if (replay.responseStatus === 200 || replay.responseStatus === 201) {
    return schema.parse(replay.responseBody);
  }
  throw new CatalogDenied(
    replay.responseStatus as 400 | 404 | 409,
    catalogDenialSchema.parse(replay.responseBody),
  );
}

/**
 * One row per Product, with its packaging and pricing already assembled.
 *
 * The default units join through `(id, product_id)` — the same pair the
 * deferred foreign keys use — so a default can only ever resolve to a unit of
 * this Product. The Third Unit is a left join because it is optional, and it
 * arrives as a bare name: there is no ratio on it to select, which is what
 * keeps it out of every conversion downstream.
 */
const PRODUCT_SELECT = `select product_row.id,
       product_row.pharmacy_id,
       product_row.definition_mode,
       product_row.medication_trade_name,
       product_row.medication_strength,
       product_row.medication_dosage_form,
       product_row.medication_manufacturer,
       product_row.general_company,
       product_row.general_sub_brand,
       product_row.general_type_of_use,
       product_row.general_property,
       product_row.general_target_audience,
       product_row.general_size,
       product_row.display_name,
       product_row.name_template_version,
       product_row.arabic_search_name,
       product_row.scientific_name,
       product_row.category,
       product_row.uses_per_day,
       product_row.uses_per_week,
       product_row.uses_per_month,
       product_row.food_timing,
       product_row.externally_visible,
       product_row.ai_sharing_allowed,
       product_row.manual_state_colour,
       product_row.cold_storage_required,
       product_row.status,
       product_row.merged_into_product_id,
       product_row.revision::text,
       product_row.created_at,
       product_row.pricing_method,
       product_row.retail_price_fils::text as retail_price_fils,
       product_row.wholesale_price_fils::text as wholesale_price_fils,
       product_row.margin_percentage::text as margin_percentage,
       product_row.price_rounding,
       inventory_unit.name as inventory_unit_name,
       third_unit.name as third_unit_name,
       count_unit.kind as count_default_kind,
       count_unit.name as count_default_name,
       purchase_unit.kind as purchase_default_kind,
       purchase_unit.name as purchase_default_name,
       sale_unit.kind as sale_default_kind,
       sale_unit.name as sale_default_name,
       (
         select coalesce(
           json_agg(
             json_build_object(
               'value', barcode_row.barcode,
               'kind', barcode_row.kind,
               'source', barcode_row.source
             )
             order by barcode_row.ordinal
           ),
           '[]'::json
         )
         from catalog_product_barcodes barcode_row
         where barcode_row.product_id = product_row.id
           and barcode_row.pharmacy_id = product_row.pharmacy_id
           and barcode_row.removed_at is null
       ) as barcodes,
       (
         select coalesce(
           json_agg(
             json_build_object(
               'name', package_row.name,
               'baseUnitsPerPackage', package_row.base_units_per_package::text
             )
             order by package_row.ordinal
           ),
           '[]'::json
         )
         from catalog_product_units package_row
         where package_row.product_id = product_row.id
           and package_row.pharmacy_id = product_row.pharmacy_id
           and package_row.kind = 'package'
       ) as package_units
from catalog_products product_row
join catalog_product_units inventory_unit
  on inventory_unit.product_id = product_row.id
 and inventory_unit.pharmacy_id = product_row.pharmacy_id
 and inventory_unit.kind = 'inventory'
join catalog_product_units count_unit
  on count_unit.id = product_row.count_default_unit_id
 and count_unit.product_id = product_row.id
join catalog_product_units purchase_unit
  on purchase_unit.id = product_row.purchase_default_unit_id
 and purchase_unit.product_id = product_row.id
join catalog_product_units sale_unit
  on sale_unit.id = product_row.sale_default_unit_id
 and sale_unit.product_id = product_row.id
left join catalog_product_third_units third_unit
  on third_unit.product_id = product_row.id
 and third_unit.pharmacy_id = product_row.pharmacy_id`;
