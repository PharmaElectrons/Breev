import {
  saleQuickAccessReadContract,
  saleQuickAccessReplaceContract,
  saleQuickAccessReplaceRequestSchema,
  salesDenialSchema,
  type CatalogFieldError,
  type IdentityDenial,
  type SaleQuickAccess,
  type SaleQuickAccessReplaceRequest,
  type SalesDenial,
} from "@breev/contracts/local-rest";
import { Injectable, Logger } from "@nestjs/common";
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
} from "../posting/idempotency.js";

const COMMAND = "sale.quick-access.replace";
const MANAGE_PERMISSION = "sales.quick_access.manage" as const;
const READ_PERMISSION = "sales.drafts.manage" as const;
const BIGINT_MAX = 9_223_372_036_854_775_807n;

type Categories = SaleQuickAccessReplaceRequest["categories"];
type ProjectedTile = SaleQuickAccess["categories"][number]["tiles"][number];
type FieldError = CatalogFieldError & { readonly rule?: string };

interface SettingsRow {
  readonly version: string;
  readonly categories: unknown;
}

interface ProductUnitRow {
  readonly product_id: string;
  readonly display_name: string;
  readonly retail_price_fils: string;
  readonly unit_id: string;
  readonly unit_name: string;
  readonly unit_ratio: string;
  readonly default_ratio: string;
}

class QuickAccessRejected extends Error {
  public constructor(
    public readonly code: SalesDenial["code"],
    public readonly fieldErrors: readonly FieldError[],
    public readonly statusCode: 400 | 409,
  ) {
    super(code);
  }
}

export class SaleQuickAccessDenied extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly denial: IdentityDenial | SalesDenial,
  ) {
    super(denial.code);
  }
}

@Injectable()
export class SaleQuickAccessService {
  private readonly logger = new Logger(SaleQuickAccessService.name);

  public constructor(
    private readonly database: LocalDatabaseService,
    private readonly identity: IdentityAccessService,
  ) {}

  public async read(request: Request): Promise<SaleQuickAccess> {
    const context = await this.identity.requirePermission(
      request,
      READ_PERMISSION,
    );
    const client = await this.database.requirePool().connect();
    try {
      return saleQuickAccessReadContract.responses[200].parse(
        await this.project(client, context.pharmacyId),
      );
    } finally {
      client.release();
    }
  }

  public async rejectInvalidBody(
    request: Request,
    fieldErrors: readonly FieldError[],
  ): Promise<never> {
    await this.identity.requirePermission(request, READ_PERMISSION);
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const client = await this.database.requirePool().connect();
    try {
      const requestId = await writePostingAudit(client, {
        action: COMMAND,
        actorUserId: context.actorId,
        device: context,
        identitySessionId: context.sessionId,
        outcome: "body-invalid",
        pharmacyId: context.pharmacyId,
      });
      throw denied(400, "body-invalid", requestId, fieldErrors);
    } finally {
      client.release();
    }
  }

  public async replace(
    request: Request,
    input: SaleQuickAccessReplaceRequest,
  ): Promise<SaleQuickAccess> {
    await this.identity.requirePermission(request, READ_PERMISSION);
    const context = await this.identity.requirePermission(
      request,
      MANAGE_PERMISSION,
    );
    const requestHash = canonicalRequestHash(COMMAND, input);
    return await runWholeCommandWithRetry(async () => {
      const client = await this.database.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        await this.identity.revalidateSaleQuickAccess(client, context);
        let replay;
        try {
          replay = await beginPostingIdempotency(client, {
            commandName: COMMAND,
            idempotencyKey: input.idempotencyKey,
            pharmacyId: context.pharmacyId,
            requestHash,
          });
        } catch (error) {
          if (!(error instanceof PostingIdempotencyConflict)) throw error;
          const requestId = await this.audit(
            client,
            context,
            input.idempotencyKey,
            "idempotency-conflict",
          );
          await client.query("commit");
          transactionOpen = false;
          throw denied(409, "idempotency-conflict", requestId);
        }
        if (replay !== undefined) {
          await client.query("commit");
          transactionOpen = false;
          if (replay.responseStatus === 200) {
            return saleQuickAccessReplaceContract.responses[200].parse(
              replay.responseBody,
            );
          }
          throw new SaleQuickAccessDenied(
            replay.responseStatus,
            salesDenialSchema.parse(replay.responseBody),
          );
        }
        await client.query("savepoint quick_access_work");
        let beforeVersion = "1";
        let value: SaleQuickAccess;
        try {
          await client.query(
            `insert into sale_quick_access_settings (pharmacy_id)
             values ($1) on conflict (pharmacy_id) do nothing`,
            [context.pharmacyId],
          );
          const current = await client.query<SettingsRow>(
            `select version::text, categories from sale_quick_access_settings
             where pharmacy_id=$1 for update`,
            [context.pharmacyId],
          );
          const row = current.rows[0];
          if (row === undefined)
            throw new Error("Quick-access settings missing");
          beforeVersion = row.version;
          if (row.version !== input.expectedVersion) {
            throw new QuickAccessRejected(
              "version-conflict",
              [
                {
                  code: "invalid",
                  path: ["expectedVersion"],
                  rule: "sales.quick-access.version-conflict",
                },
              ],
              409,
            );
          }
          validateCategoryNames(input.categories);
          await this.projectCategories(
            client,
            context.pharmacyId,
            input.categories,
            true,
          );
          await client.query(
            `update sale_quick_access_settings
             set version=version+1, categories=$2::jsonb,
                 updated_at=statement_timestamp(), updated_by=$3
             where pharmacy_id=$1`,
            [
              context.pharmacyId,
              JSON.stringify(input.categories),
              context.actorId,
            ],
          );
          value = saleQuickAccessReplaceContract.responses[200].parse(
            await this.project(client, context.pharmacyId),
          );
        } catch (error) {
          if (!(error instanceof QuickAccessRejected)) throw error;
          await client.query("rollback to savepoint quick_access_work");
          const requestId = await this.audit(
            client,
            context,
            input.idempotencyKey,
            error.code,
          );
          const response = denied(
            error.statusCode,
            error.code,
            requestId,
            error.fieldErrors,
          );
          await recordPostingResult(client, {
            actorUserId: context.actorId,
            commandName: COMMAND,
            device: context,
            idempotencyKey: input.idempotencyKey,
            identitySessionId: context.sessionId,
            pharmacyId: context.pharmacyId,
            requestHash,
            responseBody: response.denial,
            responseStatus: error.statusCode,
          });
          await client.query("commit");
          transactionOpen = false;
          throw response;
        }
        await writePostingAudit(client, {
          action: COMMAND,
          actorUserId: context.actorId,
          beforeState: { version: beforeVersion },
          afterState: {
            version: value.version,
            categoryCount: value.categories.length,
          },
          correlationId: input.idempotencyKey,
          device: context,
          identitySessionId: context.sessionId,
          outcome: "committed",
          pharmacyId: context.pharmacyId,
          targetId: context.pharmacyId,
        });
        await recordPostingResult(client, {
          actorUserId: context.actorId,
          commandName: COMMAND,
          device: context,
          idempotencyKey: input.idempotencyKey,
          identitySessionId: context.sessionId,
          pharmacyId: context.pharmacyId,
          requestHash,
          responseBody: value,
          responseStatus: 200,
        });
        await client.query("commit");
        transactionOpen = false;
        return value;
      } catch (error) {
        if (transactionOpen)
          await client.query("rollback").catch(() => undefined);
        if (!(error instanceof SaleQuickAccessDenied)) {
          this.logger.error(
            "Quick-access command failed",
            error instanceof Error ? error.stack : String(error),
          );
        }
        throw error;
      } finally {
        client.release();
      }
    });
  }

  private async project(
    client: PoolClient,
    pharmacyId: string,
  ): Promise<SaleQuickAccess> {
    const settings = await client.query<SettingsRow>(
      `select version::text, categories from sale_quick_access_settings
       where pharmacy_id=$1`,
      [pharmacyId],
    );
    const row = settings.rows[0];
    const categories =
      row === undefined
        ? []
        : saleQuickAccessReplaceRequestSchema.shape.categories.parse(
            row.categories,
          );
    return {
      version: row?.version ?? "1",
      categories: await this.projectCategories(
        client,
        pharmacyId,
        categories,
        false,
      ),
    };
  }

  private async projectCategories(
    client: PoolClient,
    pharmacyId: string,
    categories: Categories,
    validate: boolean,
  ): Promise<SaleQuickAccess["categories"]> {
    const ids = [
      ...new Set(
        categories.flatMap((category) =>
          category.tiles.map((tile) => tile.productId),
        ),
      ),
    ];
    if (ids.length === 0)
      return categories.map((category) => ({
        name: category.name,
        tiles: [],
      }));
    const products = await client.query<ProductUnitRow>(
      `select product.id as product_id, product.display_name,
              product.retail_price_fils::text, unit_row.id as unit_id,
              unit_row.name as unit_name,
              coalesce(unit_row.base_units_per_package,1)::text as unit_ratio,
              coalesce(default_unit.base_units_per_package,1)::text as default_ratio
       from catalog_products product
       join catalog_product_units unit_row on unit_row.product_id=product.id
         and unit_row.pharmacy_id=product.pharmacy_id
       join catalog_product_units default_unit
         on default_unit.id=product.sale_default_unit_id
         and default_unit.product_id=product.id
       where product.pharmacy_id=$1 and product.id=any($2::uuid[])
         and product.status='active'
       ${validate ? "for share of product, unit_row, default_unit" : ""}`,
      [pharmacyId, ids],
    );
    const unitMap = new Map(
      products.rows.map((row) => [`${row.product_id}:${row.unit_id}`, row]),
    );
    return categories.map((category, categoryIndex) => ({
      name: category.name,
      tiles: category.tiles.flatMap((tile, tileIndex): ProjectedTile[] => {
        const row = unitMap.get(`${tile.productId}:${tile.unitId}`);
        if (row === undefined) {
          if (validate)
            throw new QuickAccessRejected(
              "sale-quick-access-invalid",
              [
                {
                  code: "invalid",
                  path: [
                    "categories",
                    categoryIndex,
                    "tiles",
                    tileIndex,
                    "unitId",
                  ],
                },
              ],
              400,
            );
          return [
            {
              productId: tile.productId,
              unitId: tile.unitId,
              available: false,
              displayName: null,
              unitName: null,
              currentUnitPriceFils: null,
            },
          ];
        }
        const price =
          (BigInt(row.retail_price_fils) * BigInt(row.unit_ratio) +
            BigInt(row.default_ratio) / 2n) /
          BigInt(row.default_ratio);
        if (price > BIGINT_MAX) {
          if (validate)
            throw new QuickAccessRejected(
              "sale-quick-access-invalid",
              [
                {
                  code: "out-of-range",
                  path: [
                    "categories",
                    categoryIndex,
                    "tiles",
                    tileIndex,
                    "unitId",
                  ],
                },
              ],
              400,
            );
          return [
            {
              productId: tile.productId,
              unitId: tile.unitId,
              available: false,
              displayName: null,
              unitName: null,
              currentUnitPriceFils: null,
            },
          ];
        }
        return [
          {
            productId: tile.productId,
            unitId: tile.unitId,
            available: true,
            displayName: row.display_name,
            unitName: row.unit_name,
            currentUnitPriceFils: price.toString(),
          },
        ];
      }),
    }));
  }

  private async audit(
    client: PoolClient,
    context: IdentityExecutionContext,
    correlationId: string,
    outcome: string,
  ): Promise<string> {
    return await writePostingAudit(client, {
      action: COMMAND,
      actorUserId: context.actorId,
      correlationId,
      device: context,
      identitySessionId: context.sessionId,
      outcome,
      pharmacyId: context.pharmacyId,
      targetId: context.pharmacyId,
    });
  }
}

function validateCategoryNames(categories: Categories): void {
  const names = new Set<string>();
  for (let index = 0; index < categories.length; index += 1) {
    const key = categories[index]!.name.toLocaleLowerCase();
    if (names.has(key))
      throw new QuickAccessRejected(
        "sale-quick-access-invalid",
        [
          {
            code: "invalid",
            path: ["categories", index, "name"],
          },
        ],
        400,
      );
    names.add(key);
  }
}

function denied(
  statusCode: 400 | 409,
  code: SalesDenial["code"],
  requestId: string,
  fieldErrors: readonly FieldError[] = [],
): SaleQuickAccessDenied {
  return new SaleQuickAccessDenied(
    statusCode,
    salesDenialSchema.parse({
      status: "denied",
      code,
      requestId,
      fieldErrors,
    }),
  );
}
