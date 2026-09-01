import {
  CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
  generateDisplayName,
  isProductNameTemplateVersion,
  catalogDenialSchema,
  productSchema,
  type CatalogDenial,
  type CatalogDenialCode,
  type CatalogFieldError,
  type Product,
  type ProductArchiveRequest,
  type ProductCreateRequest,
  type ProductDefinition,
  type ProductEditRequest,
  type ProductMergeRequest,
  type ProductNameTemplateVersion,
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

const CATALOG_PERMISSION = "catalog.item.manage";
const BARCODE_LOCK_NAMESPACE = 165_308_863;

const COMMANDS = {
  archive: "catalog.product.archive",
  create: "catalog.product.create",
  edit: "catalog.product.edit",
  merge: "catalog.product.merge",
} as const;

type CatalogCommandName = (typeof COMMANDS)[keyof typeof COMMANDS];

interface ProductRow {
  readonly ai_sharing_allowed: boolean;
  readonly arabic_search_name: string | null;
  readonly barcodes: string[];
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
  readonly manual_state_colour:
    "blue" | "green" | "grey" | "orange" | "purple" | "red" | "yellow" | null;
  readonly medication_dosage_form: string | null;
  readonly medication_manufacturer: string | null;
  readonly medication_strength: string | null;
  readonly medication_trade_name: string | null;
  readonly merged_into_product_id: string | null;
  readonly name_template_version: number;
  readonly pharmacy_id: string;
  readonly revision: string;
  readonly scientific_name: string | null;
  readonly status: "active" | "archived" | "merged";
  readonly uses_per_day: number | null;
  readonly uses_per_month: number | null;
  readonly uses_per_week: number | null;
}

interface CommandSuccess {
  readonly afterState: Record<string, boolean | number | string | null>;
  readonly beforeState?: Record<string, boolean | number | string | null>;
  readonly product: Product;
}

interface CommandExecution {
  readonly commandName: CatalogCommandName;
  readonly context: IdentityExecutionContext;
  readonly idempotencyKey: string;
  readonly requestHash: Buffer;
  readonly responseStatus: 200 | 201;
  readonly targetId?: string;
  readonly work: (client: PoolClient) => Promise<CommandSuccess>;
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
      work: async (client) => {
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
             created_by, updated_by
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
             $26, $26
           ) returning id`,
          [
            ...productWriteValues(
              context,
              input,
              displayName,
              CURRENT_PRODUCT_NAME_TEMPLATE_VERSION,
            ),
          ],
        );
        const productId = result.rows[0]?.id;
        if (productId === undefined) {
          throw new Error("The Catalog Product was not created");
        }
        await replaceBarcodes(client, context, productId, input.barcodes);
        const product = await requiredProduct(
          client,
          context.pharmacyId,
          productId,
        );
        return {
          afterState: productAuditState(product),
          product: productView(product),
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
      targetId: productId,
      work: async (client) => {
        const before = await lockProduct(client, context.pharmacyId, productId);
        requireEditable(before, productId, input.expectedRevision);
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
          context,
          input,
          displayName,
          templateVersion,
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
               updated_by = $26,
               updated_at = statement_timestamp(),
               revision = revision + 1
           where id = $27 and pharmacy_id = $1`,
          [...values, productId],
        );
        if (updated.rowCount !== 1) {
          throw new Error("The Catalog Product edit was not applied");
        }
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
          product: productView(after),
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
          product: productView(after),
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
          product: productView(after),
        };
      },
    });
  }

  public async rejectInvalidBody(
    request: Request,
    action: string,
    fieldErrors: readonly CatalogFieldError[],
    targetId?: string,
  ): Promise<never> {
    const context = await this.identity.requirePermission(
      request,
      CATALOG_PERMISSION,
    );
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

  private async executeCommand(input: CommandExecution): Promise<Product> {
    return await runWholeCommandWithRetry(
      async () => await this.executeCommandAttempt(input),
    );
  }

  private async executeCommandAttempt(
    input: CommandExecution,
  ): Promise<Product> {
    const client = await this.localDatabase.requirePool().connect();
    let transactionOpen = false;
    try {
      await client.query("begin");
      transactionOpen = true;
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
        return replayCatalogOutcome(replay);
      }

      let success: CommandSuccess;
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
        targetId: success.product.id,
      });
      await recordPostingResult(client, {
        actorUserId: input.context.actorId,
        commandName: input.commandName,
        device: input.context,
        idempotencyKey: input.idempotencyKey,
        identitySessionId: input.context.sessionId,
        pharmacyId: input.context.pharmacyId,
        requestHash: input.requestHash,
        responseBody: success.product,
        responseStatus: input.responseStatus,
      });
      await client.query("commit");
      transactionOpen = false;
      return success.product;
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
  context: IdentityExecutionContext,
  input: ProductCreateRequest | ProductEditRequest,
  displayName: string,
  templateVersion: ProductNameTemplateVersion,
): readonly unknown[] {
  const definition = definitionColumns(input.definition);
  return [
    context.pharmacyId,
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
    context.actorId,
  ];
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
  barcodes: readonly string[],
): Promise<void> {
  for (const barcode of [...barcodes].sort()) {
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
    [pharmacyId, barcodes, productId ?? null],
  );
  const conflictingBarcode = conflict.rows[0]?.barcode;
  if (conflictingBarcode !== undefined) {
    throw new CatalogCommandRejected(400, "body-invalid", [
      {
        code: "invalid",
        path: ["barcodes", barcodes.indexOf(conflictingBarcode)],
      },
    ]);
  }
}

async function replaceBarcodes(
  client: PoolClient,
  context: IdentityExecutionContext,
  productId: string,
  barcodes: readonly string[],
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
         pharmacy_id, product_id, barcode, ordinal, recorded_by
       ) values ($1, $2, $3, $4, $5)
       on conflict (product_id, barcode) do update
       set ordinal = excluded.ordinal,
           removed_at = null,
           removed_by = null`,
      [context.pharmacyId, productId, barcode, ordinal, context.actorId],
    );
  }
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

function replayCatalogOutcome(replay: PostingCommandReplay): Product {
  if (replay.responseStatus === 200 || replay.responseStatus === 201) {
    return productSchema.parse(replay.responseBody);
  }
  throw new CatalogDenied(
    replay.responseStatus as 400 | 404 | 409,
    catalogDenialSchema.parse(replay.responseBody),
  );
}

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
       array(
         select barcode_row.barcode
         from catalog_product_barcodes barcode_row
         where barcode_row.product_id = product_row.id
           and barcode_row.pharmacy_id = product_row.pharmacy_id
           and barcode_row.removed_at is null
         order by barcode_row.ordinal
       ) as barcodes
from catalog_products product_row`;
