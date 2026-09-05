import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const POSTGRES_IMAGE = "postgres:18.6-bookworm";

describe.sequential("Catalog packaging and pricing forward migration", () => {
  let pool: Pool;
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
  });

  it("backfills terminal Products and immutable snapshots, then restores their guards", async () => {
    await createPreviousCatalogSchema(pool);
    await seedPreviousCatalogFacts(pool);

    const migration = await readFile(
      path.resolve(
        import.meta.dirname,
        "../../drizzle/0013_catalog_packaging_pricing.sql",
      ),
      "utf8",
    );
    const snapshotWriter = await pool.connect();
    let announceSnapshotLock: (() => void) | undefined;
    const snapshotLockRequested = new Promise<void>((resolve) => {
      announceSnapshotLock = resolve;
    });
    let migrationPromise: Promise<void> | undefined;
    try {
      await snapshotWriter.query("begin");
      await snapshotWriter.query(
        "lock table catalog_product_snapshots in row exclusive mode",
      );
      migrationPromise = applyMigration(pool, migration, () =>
        announceSnapshotLock?.(),
      );
      await snapshotLockRequested;
      await snapshotWriter.query("set local statement_timeout = '2s'");
      await snapshotWriter.query(
        `select id from catalog_products
         where status = 'active'
         for share`,
      );
      await snapshotWriter.query("commit");
    } finally {
      await snapshotWriter.query("rollback").catch(() => undefined);
      snapshotWriter.release();
    }
    await migrationPromise;

    const products = await pool.query<{
      count_default_unit_id: string;
      pricing_method: string;
      retail_price_fils: string;
      status: string;
    }>(
      `select status, count_default_unit_id, pricing_method,
              retail_price_fils::text
       from catalog_products
       order by status`,
    );
    expect(products.rows).toEqual([
      expect.objectContaining({
        pricing_method: "by-price",
        retail_price_fils: "0",
        status: "active",
      }),
      expect.objectContaining({
        pricing_method: "by-price",
        retail_price_fils: "0",
        status: "archived",
      }),
      expect.objectContaining({
        pricing_method: "by-price",
        retail_price_fils: "0",
        status: "merged",
      }),
    ]);
    expect(
      products.rows.every(
        (product) => product.count_default_unit_id.length > 0,
      ),
    ).toBe(true);

    const facts = await pool.query<{
      snapshot_count: string;
      unit_count: string;
    }>(
      `select
         (select count(*)::text from catalog_product_units) as unit_count,
         (select count(*)::text from catalog_product_snapshots
          where inventory_unit_name = 'Unit'
            and pricing_method = 'by-price'
            and retail_price_fils = 0) as snapshot_count`,
    );
    expect(facts.rows[0]).toEqual({ snapshot_count: "3", unit_count: "3" });

    await expect(
      pool.query(
        "update catalog_products set display_name = 'rewritten' where status = 'archived'",
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query(
        "update catalog_products set display_name = 'rewritten' where status = 'merged'",
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query(
        "update catalog_products set display_name = 'rewritten' where status = 'active'",
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query(
        "update catalog_product_snapshots set display_name = 'rewritten'",
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});

async function applyMigration(
  pool: Pool,
  migration: string,
  snapshotLockRequested: () => void,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim().length === 0) continue;
      const query = client.query(statement);
      if (
        statement.includes(
          "lock table catalog_product_snapshots in access exclusive mode",
        )
      ) {
        snapshotLockRequested();
      }
      await query;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function createPreviousCatalogSchema(pool: Pool): Promise<void> {
  await pool.query(`
    create role breev_app;
    create table pharmacies (id uuid primary key);
    create table catalog_products (
      id uuid primary key,
      pharmacy_id uuid not null references pharmacies(id),
      status text not null,
      merged_into_product_id uuid,
      display_name text not null,
      name_template_version integer not null,
      revision bigint not null,
      unique (id, pharmacy_id)
    );
    create table catalog_product_snapshots (
      id uuid primary key default uuidv7(),
      pharmacy_id uuid not null references pharmacies(id),
      product_id uuid not null,
      display_name text not null,
      name_template_version integer not null,
      unique (id, pharmacy_id),
      foreign key (product_id, pharmacy_id)
        references catalog_products(id, pharmacy_id)
    );
    create function enforce_catalog_product_change()
    returns trigger language plpgsql as $$
    begin
      if tg_op = 'DELETE' then
        raise exception 'Catalog Products are never deleted'
          using errcode = '55000';
      end if;
      if old.status <> 'active' then
        raise exception 'Archived and merged Catalog Products are immutable'
          using errcode = '55000';
      end if;
      if new.revision <> old.revision + 1 then
        raise exception 'Invalid Catalog Product revision'
          using errcode = '55000';
      end if;
      if new.status <> old.status
         and new.status not in ('archived', 'merged') then
        raise exception 'Invalid Catalog Product status transition'
          using errcode = '55000';
      end if;
      return new;
    end;
    $$;
    create trigger catalog_products_change_guard
    before update or delete on catalog_products
    for each row execute function enforce_catalog_product_change();
    create function enforce_catalog_product_merge_survivor()
    returns trigger language plpgsql as $$
    begin
      if new.status <> 'merged' then return new; end if;
      if new.merged_into_product_id is null
         or new.merged_into_product_id = new.id
         or not exists (
           select 1 from catalog_products survivor
           where survivor.id = new.merged_into_product_id
             and survivor.pharmacy_id = new.pharmacy_id
             and survivor.status = 'active'
         ) then
        raise exception 'The Catalog merge survivor is invalid'
          using errcode = '23514';
      end if;
      return new;
    end;
    $$;
    create trigger catalog_products_merge_survivor_guard
    before insert or update on catalog_products
    for each row execute function enforce_catalog_product_merge_survivor();
    create function prepare_catalog_product_snapshot()
    returns trigger language plpgsql as $$
    begin
      return new;
    end;
    $$;
    create trigger catalog_product_snapshots_prepare
    before insert on catalog_product_snapshots
    for each row execute function prepare_catalog_product_snapshot();
    create function reject_catalog_snapshot_mutation()
    returns trigger language plpgsql as $$
    begin
      raise exception 'Posted Catalog Product snapshots are immutable'
        using errcode = '55000';
    end;
    $$;
    create trigger catalog_product_snapshots_immutable
    before update or delete on catalog_product_snapshots
    for each row execute function reject_catalog_snapshot_mutation();
  `);
}

async function seedPreviousCatalogFacts(pool: Pool): Promise<void> {
  await pool.query(`
    insert into pharmacies (id)
    values ('018f0000-0000-7000-8000-000000000001');
    insert into catalog_products (
      id, pharmacy_id, status, display_name, name_template_version, revision
    ) values
      (
        '018f0000-0000-7000-8000-000000000002',
        '018f0000-0000-7000-8000-000000000001',
        'active', 'Active Product', 1, 1
      ),
      (
        '018f0000-0000-7000-8000-000000000003',
        '018f0000-0000-7000-8000-000000000001',
        'active', 'Archived Product', 1, 1
      ),
      (
        '018f0000-0000-7000-8000-000000000004',
        '018f0000-0000-7000-8000-000000000001',
        'active', 'Merged Product', 1, 1
      );
    insert into catalog_product_snapshots (
      pharmacy_id, product_id, display_name, name_template_version
    ) values
      (
        '018f0000-0000-7000-8000-000000000001',
        '018f0000-0000-7000-8000-000000000002',
        'Active snapshot', 1
      ),
      (
        '018f0000-0000-7000-8000-000000000001',
        '018f0000-0000-7000-8000-000000000003',
        'Archived snapshot', 1
      ),
      (
        '018f0000-0000-7000-8000-000000000001',
        '018f0000-0000-7000-8000-000000000004',
        'Merged snapshot', 1
      );
    update catalog_products
    set status = 'archived', revision = 2
    where id = '018f0000-0000-7000-8000-000000000003';
    update catalog_products
    set status = 'merged',
        merged_into_product_id = '018f0000-0000-7000-8000-000000000002',
        revision = 2
    where id = '018f0000-0000-7000-8000-000000000004';
  `);
}
