import { randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  createSeparatedDatabaseRoles,
  createSeparatedDatabaseRolesFromUrl,
  type SeparatedDatabaseRoles,
} from "../../test/database-roles.js";
import { seedOwnerRoleWithFloor } from "../../test/owner-floor-fixture.js";
import { runMigrations } from "../database-migrations.js";
import { beginPostingIdempotency } from "../posting/idempotency.js";
import { NO_INVOICE_OFFER_SNAPSHOT } from "./purchase-invoice-offer.js";

describe.sequential("0032 invoice offer forward migration", () => {
  let administrator: Pool;
  let application: Pool;
  let roles: SeparatedDatabaseRoles;
  let postgres: StartedPostgreSqlContainer | undefined;
  let priorFolder: string;
  let pharmacyId: string;
  let ownerId: string;
  let supplierId: string;
  let draftId: string;
  let purchaseId: string;
  let oldPosted: unknown;
  let oldReceipt: unknown;
  let oldRoleRevisions: { id: string; revision: string }[];
  const receiptHash = randomBytes(32);
  const receiptKey = "11111111-1111-4111-8111-111111111111";
  beforeAll(async () => {
    const adminUrl = process.env.BREEV_TEST_POSTGRES_ADMIN_URL;
    if (adminUrl === undefined) {
      postgres = await new PostgreSqlContainer(
        "postgres:18.6-bookworm",
      ).start();
      roles = await createSeparatedDatabaseRoles(postgres);
    } else roles = await createSeparatedDatabaseRolesFromUrl(adminUrl);
    administrator = new Pool({ connectionString: roles.migrationUrl });
    application = new Pool({ connectionString: roles.applicationUrl });
    const folder = path.resolve(import.meta.dirname, "../../drizzle");
    const journal = JSON.parse(
      await readFile(path.join(folder, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const entries = journal.entries.filter((entry) => entry.idx <= 31);
    priorFolder = await mkdtemp(path.join(tmpdir(), "breev-pre-offer-"));
    await mkdir(path.join(priorFolder, "meta"));
    await writeFile(
      path.join(priorFolder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    for (const entry of entries)
      await copyFile(
        path.join(folder, `${entry.tag}.sql`),
        path.join(priorFolder, `${entry.tag}.sql`),
      );
    await migrate(drizzle(administrator), {
      migrationsFolder: priorFolder,
      migrationsSchema: "breev_migrations",
      migrationsTable: "breev_schema_migrations",
    });
    pharmacyId = (
      await application.query<{ id: string }>(
        "insert into pharmacies(id,name) values(uuidv7(),'Offer migration pharmacy') returning id",
      )
    ).rows[0]!.id;
    const ids = (
      await application.query<{ actor: string; role: string; device: string }>(
        "select uuidv7() as actor,uuidv7() as role,uuidv7() as device",
      )
    ).rows[0]!;
    ownerId = ids.actor;
    await seedOwnerRoleWithFloor(application, {
      actorId: ownerId,
      displayName: "Migration owner",
      pharmacyId,
      roleId: ids.role,
      username: "offer.migration.owner",
    });
    await application.query(
      "insert into main_devices(id,credential_hash) values($1,$2)",
      [ids.device, randomBytes(32)],
    );
    supplierId = (
      await application.query<{ id: string }>(
        "insert into suppliers(pharmacy_id,name,created_by,updated_by) values($1,'Historical supplier',$2,$2) returning id",
        [pharmacyId, ownerId],
      )
    ).rows[0]!.id;
    await application.query(
      "insert into supplier_allowance_rates(pharmacy_id,supplier_id,effective_from,allowance_percentage,recorded_by) values($1,$2,'2026-01-01',10,$3)",
      [pharmacyId, supplierId, ownerId],
    );
    draftId = (
      await application.query<{ id: string }>(
        `insert into purchase_drafts(pharmacy_id,supplier_id,supplier_name_snapshot,supplier_invoice_number,invoice_date,settlement_context,allowance_percentage_snapshot,allowance_basis_fils,created_by,updated_by)
      values($1,$2,'Historical supplier','PRE-OFFER','2026-09-30','debt',10,10000,$3,$3) returning id`,
        [pharmacyId, supplierId, ownerId],
      )
    ).rows[0]!.id;
    const journalId = (
      await application.query<{ id: string }>(
        "insert into accounting_journal_entries(pharmacy_id,template_id,template_version,posted_by) values($1,'purchase.invoice',1,$2) returning id",
        [pharmacyId, ownerId],
      )
    ).rows[0]!.id;
    purchaseId = (
      await application.query<{ id: string }>(
        `insert into posted_purchases(pharmacy_id,draft_id,supplier_id,supplier_name_snapshot,supplier_invoice_number,invoice_date,settlement_context,allowance_percentage_snapshot,allowance_basis_fils,allowance_fils,cost_after_discount_fils,primary_supplier_cost_fils,number_value,number_year,journal_entry_id,posted_by)
      values($1,$2,$3,'Historical supplier','PRE-OFFER','2026-09-30','debt',10,10000,1000,9000,10000,1,2026,$4,$5) returning id`,
        [pharmacyId, draftId, supplierId, journalId, ownerId],
      )
    ).rows[0]!.id;
    oldReceipt = {
      posted: {
        id: purchaseId,
        primarySupplierCostFils: "10000",
        allowanceFils: "1000",
        costAfterDiscountFils: "9000",
      },
    };
    await application.query(
      `insert into posting_command_results(pharmacy_id,command_name,idempotency_key,actor_user_id,main_device_id,request_hash,response_status,response_body)
      values($1,'purchase.post',$2,$3,$4,$5,201,$6::jsonb)`,
      [
        pharmacyId,
        receiptKey,
        ownerId,
        ids.device,
        receiptHash,
        JSON.stringify(oldReceipt),
      ],
    );
    oldPosted = (
      await application.query(
        "select to_jsonb(posted) as facts from posted_purchases posted where id=$1",
        [purchaseId],
      )
    ).rows[0]!.facts;
    oldRoleRevisions = (
      await application.query<{ id: string; revision: string }>(
        "select id,revision::text from pharmacy_roles order by id",
      )
    ).rows;
    await runMigrations(application, roles.migrationUrl);
  }, 120000);
  afterAll(async () => {
    await application?.end();
    await administrator?.end();
    await postgres?.stop();
    if (
      priorFolder !== undefined &&
      path.resolve(priorFolder).startsWith(path.resolve(tmpdir()) + path.sep) &&
      path.basename(priorFolder).startsWith("breev-pre-offer-")
    )
      await rm(priorFolder, { recursive: true, force: true });
  });
  it("adds zero-offer facts without changing historical costs, receipts, hashes or role revisions", async () => {
    const posted = (
      await application.query(
        "select to_jsonb(posted)-'invoice_offer' as facts,invoice_offer from posted_purchases posted where id=$1",
        [purchaseId],
      )
    ).rows[0]!;
    expect(posted.facts).toEqual(oldPosted);
    expect(posted.invoice_offer).toEqual(NO_INVOICE_OFFER_SNAPSHOT);
    expect(
      (
        await application.query(
          "select invoice_offer,offer_rule_version from purchase_drafts where id=$1",
          [draftId],
        )
      ).rows[0],
    ).toEqual({
      invoice_offer: { mode: "none", value: "0" },
      offer_rule_version: 1,
    });
    // Migration 0036 grants reports.inventory.view and reports.inventory.export to owner (+1).
    expect(
      (
        await application.query(
          "select id,revision::text from pharmacy_roles order by id",
        )
      ).rows,
    ).toEqual(
      oldRoleRevisions.map((role) => ({
        ...role,
        revision: String(BigInt(role.revision) + 1n),
      })),
    );
    const receipt = (
      await application.query(
        "select response_body,request_hash,purchase_offer_receipt_version from posting_command_results where idempotency_key=$1",
        [receiptKey],
      )
    ).rows[0]!;
    expect(receipt.response_body).toEqual(oldReceipt);
    expect(receipt.purchase_offer_receipt_version).toBe(0);
    expect(receipt.request_hash).toEqual(receiptHash);
    const client = await application.connect();
    try {
      await client.query("begin");
      expect(
        await beginPostingIdempotency(client, {
          pharmacyId,
          commandName: "purchase.post",
          idempotencyKey: receiptKey,
          requestHash: receiptHash,
        }),
      ).toMatchObject({
        responseBody: {
          posted: { id: purchaseId, invoiceOffer: NO_INVOICE_OFFER_SNAPSHOT },
        },
      });
      await client.query("commit");
    } finally {
      client.release();
    }
    expect(
      (
        await application.query(
          "select response_body from posting_command_results where idempotency_key=$1",
          [receiptKey],
        )
      ).rows[0]!.response_body,
    ).toEqual(oldReceipt);
    expect(
      (
        await application.query(
          "select column_default from information_schema.columns where table_name='posting_command_results' and column_name='purchase_offer_receipt_version'",
        )
      ).rows[0]!.column_default,
    ).toBe("1");
    await expect(
      application.query(
        "update posted_purchases set invoice_offer=invoice_offer where id=$1",
        [purchaseId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      application.query(
        "update posting_command_results set response_body=response_body where idempotency_key=$1",
        [receiptKey],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      administrator.query(
        "update posting_command_results set response_body=response_body where idempotency_key=$1",
        [receiptKey],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
  it.each([
    { mode: "fixed", value: "-1" },
    { mode: "percentage", value: "100.000001" },
    { mode: "percentage", value: "5.0000001" },
    { mode: "none", value: "1" },
    { mode: "fixed", value: "1", other: true },
  ])("rejects malformed persisted offer %j", async (value) => {
    await expect(
      application.query(
        "update purchase_drafts set invoice_offer=$2::jsonb,version=version+1 where id=$1",
        [draftId, JSON.stringify(value)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it.each([
    { input: { mode: "fixed", value: "1" }, basisFils: "100", offerFils: "1" },
    {
      input: { mode: "percentage", value: "5" },
      ruleVersion: 1,
      basisFils: "100",
      offerFils: "6",
    },
    {
      input: { mode: "fixed", value: "1" },
      ruleVersion: 2,
      basisFils: "100",
      offerFils: "1",
    },
  ])(
    "rejects missing, unsupported or inconsistent snapshot %j",
    async (value) => {
      expect(
        (
          await application.query(
            "select valid_purchase_offer_snapshot($1::jsonb) as valid",
            [JSON.stringify(value)],
          )
        ).rows[0]!.valid,
      ).toBe(false);
    },
  );
  it("stores one current receipt projection while retaining every original payload", async () => {
    const snapshot = NO_INVOICE_OFFER_SNAPSHOT;
    const additions = {
      invoiceOffer: { mode: "none", value: "0" },
      offerRuleVersion: 1,
    };
    for (const [command, body, expected] of [
      [
        "purchase.draft.create",
        { draft: { id: draftId }, warnings: [] },
        { draft: { id: draftId, ...additions }, warnings: [] },
      ],
      [
        "purchase.draft.row.update",
        { draft: { id: draftId, review: { netFils: "9000" } }, warnings: [] },
        {
          draft: {
            id: draftId,
            review: { netFils: "9000", invoiceOffer: snapshot },
            ...additions,
          },
          warnings: [],
        },
      ],
      [
        "purchase.draft.row.discard",
        { id: draftId, review: { netFils: "9000" } },
        {
          id: draftId,
          review: { netFils: "9000", invoiceOffer: snapshot },
          ...additions,
        },
      ],
      [
        "purchase.adjustment-draft.update",
        { id: draftId },
        { id: draftId, ...additions },
      ],
      [
        "purchase.adjustment.post",
        { posted: { id: purchaseId } },
        {
          posted: {
            id: purchaseId,
            offerDeltaFils: "0",
            offerComparison: { before: snapshot, after: snapshot },
          },
        },
      ],
      ["pharmacy.settings.update", { id: pharmacyId }, { id: pharmacyId }],
    ] as const) {
      const projected = (
        await application.query(
          "select purchase_offer_receipt_projection($1,0,201,$2::jsonb) as body",
          [command, JSON.stringify(body)],
        )
      ).rows[0]!.body;
      expect(projected).toEqual(expected);
      expect(
        (
          await application.query(
            "select purchase_offer_receipt_projection($1,1,201,$2::jsonb) as body",
            [command, JSON.stringify(body)],
          )
        ).rows[0]!.body,
      ).toEqual(body);
      expect(
        (
          await application.query(
            "select purchase_offer_receipt_projection($1,0,409,$2::jsonb) as body",
            [command, JSON.stringify(body)],
          )
        ).rows[0]!.body,
      ).toEqual(body);
    }
    await expect(
      application.query(
        "select purchase_offer_receipt_projection('purchase.post',2,201,'{}'::jsonb)",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
