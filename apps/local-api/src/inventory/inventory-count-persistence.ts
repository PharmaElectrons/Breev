import type { PoolClient } from "pg";

import type { InventoryValuationState } from "./inventory-valuation.js";

/**
 * Count-session persistence is deliberately separate from the ordinary
 * inventory persistence module. It owns only the count tables and the
 * movement-derived reads needed to present a count session.
 */

export interface CountSessionRecord {
  readonly id: string;
  readonly status: "active" | "completed";
  readonly version: string;
  readonly numberValue: string | null;
  readonly numberYear: number | null;
  readonly startedAt: string;
  readonly startedBy: string;
  readonly deviceId: string;
  readonly completedAt: string | null;
  readonly completedBy: string | null;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface CountLineRecord {
  readonly id: string;
  readonly ordinal: number;
  readonly productId: string;
  readonly itemDisplayName: string;
  readonly inventoryUnitName: string;
  readonly entries: unknown;
  readonly enteredLabel: string;
  readonly countedQuantity: string;
  readonly balanceAtObservation: string;
  readonly varianceAtObservation: string;
  readonly blockedQuantityAtObservation: string;
  readonly observedAt: string;
  readonly observedBy: string;
  readonly deviceId: string;
}

export interface CountApplicationRecord {
  readonly id: string;
  readonly balanceBefore: string;
  readonly countedQuantity: string;
  readonly variance: string;
  readonly carryingAmountFils: string;
  readonly averageUnitCostScaled: string;
  readonly valuationMethod: "weighted-average-cost";
  readonly treatment: string;
  readonly reason: string;
  readonly evidence: string;
  readonly journalEntryId: string;
  readonly appliedAt: string;
  readonly appliedBy: string;
  readonly deviceId: string;
}

export interface CountLineWithApplication extends CountLineRecord {
  readonly application: CountApplicationRecord | null;
  readonly movementIds: readonly string[];
}

export interface CountSessionRead {
  readonly session: CountSessionRecord;
  readonly lines: readonly CountLineWithApplication[];
  readonly currentBalances: ReadonlyMap<string, bigint>;
}

interface CountSessionRow {
  readonly id: string;
  readonly status: "active" | "completed";
  readonly version: string;
  readonly number_value: string | null;
  readonly number_year: number | null;
  readonly started_at: string;
  readonly started_by: string;
  readonly device_id: string;
  readonly completed_at: string | null;
  readonly completed_by: string | null;
  readonly updated_at: string;
  readonly updated_by: string;
}

interface CountLineRow {
  readonly id: string;
  readonly ordinal: number;
  readonly product_id: string;
  readonly item_display_name: string;
  readonly inventory_unit_name: string;
  readonly entries: unknown;
  readonly entered_label: string;
  readonly counted_quantity: string;
  readonly balance_at_observation: string;
  readonly variance_at_observation: string;
  readonly blocked_quantity_at_observation: string;
  readonly observed_at: string;
  readonly observed_by: string;
  readonly device_id: string;
  readonly application_id: string | null;
  readonly application_balance_before: string | null;
  readonly application_counted_quantity: string | null;
  readonly application_variance: string | null;
  readonly application_carrying_amount_fils: string | null;
  readonly application_average_unit_cost_scaled: string | null;
  readonly application_valuation_method: "weighted-average-cost" | null;
  readonly application_treatment: string | null;
  readonly application_reason: string | null;
  readonly application_evidence: string | null;
  readonly application_journal_entry_id: string | null;
  readonly application_applied_at: string | null;
  readonly application_applied_by: string | null;
  readonly application_device_id: string | null;
  readonly movement_ids: readonly string[] | null;
}

interface SessionReferenceRow {
  readonly id: string;
  readonly number_value: string | null;
  readonly number_year: number | null;
  readonly started_at: string;
  readonly ordinal: number | null;
}

export interface CountSessionReference {
  readonly number: {
    readonly series: "C";
    readonly value: string;
    readonly year: number;
  } | null;
  readonly labels: ReadonlyMap<number, string>;
}

export interface CountJournalLineRecord {
  readonly accountCode: "inventory" | "inventory-count-variance";
  readonly creditFils: string;
  readonly debitFils: string;
  readonly ordinal: number;
  readonly supplierId: null;
}

export interface CountJournalRecord {
  readonly entryId: string;
  readonly templateId: "inventory.count";
  readonly templateVersion: number;
  readonly lines: readonly CountJournalLineRecord[];
}

interface CountJournalRow {
  readonly entry_id: string;
  readonly template_id: "inventory.count";
  readonly template_version: number;
  readonly ordinal: number;
  readonly account_code: "inventory" | "inventory-count-variance";
  readonly supplier_id: null;
  readonly debit_fils: string;
  readonly credit_fils: string;
}

export async function insertCountSession(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly startedBy: string;
    readonly deviceId: string;
    readonly updatedBy: string;
  },
): Promise<CountSessionRecord> {
  const result = await client.query<CountSessionRow>(
    `insert into inventory_count_sessions (
       pharmacy_id, started_by, device_id, updated_by
     ) values ($1, $2, $3, $4)
     returning id, status, version::text, number_value::text, number_year,
               started_at::text, started_by, device_id,
               completed_at::text, completed_by, updated_at::text, updated_by`,
    [input.pharmacyId, input.startedBy, input.deviceId, input.updatedBy],
  );
  const row = result.rows[0];
  if (row === undefined)
    throw new Error("The Inventory Count Session was not created");
  return mapSession(row);
}

export async function lockCountSession(
  client: PoolClient,
  pharmacyId: string,
  sessionId: string,
): Promise<CountSessionRecord | undefined> {
  const result = await client.query<CountSessionRow>(
    `select id, status, version::text, number_value::text, number_year,
            started_at::text, started_by, device_id,
            completed_at::text, completed_by, updated_at::text, updated_by
     from inventory_count_sessions
     where pharmacy_id = $1 and id = $2
     for update`,
    [pharmacyId, sessionId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : mapSession(row);
}

export async function readCountSession(
  client: PoolClient,
  pharmacyId: string,
  sessionId: string,
): Promise<CountSessionRead | undefined> {
  const session = await readSessionHeader(client, pharmacyId, sessionId);
  if (session === undefined) return undefined;
  const lines = await readLines(client, pharmacyId, [sessionId]);
  const currentBalances = await readCurrentBalances(
    client,
    pharmacyId,
    lines.map((line) => line.record.productId),
  );
  return { session, lines: lines.map((line) => line.record), currentBalances };
}

export async function listCountSessions(
  client: PoolClient,
  pharmacyId: string,
  status?: "active" | "completed",
): Promise<readonly CountSessionRead[]> {
  const result = await client.query<CountSessionRow>(
    `select id, status, version::text, number_value::text, number_year,
            started_at::text, started_by, device_id,
            completed_at::text, completed_by, updated_at::text, updated_by
     from inventory_count_sessions
     where pharmacy_id = $1
       and ($2::text is null or status::text = $2::text)
     order by case when status = 'active' then 0 else 1 end,
              updated_at desc, id`,
    [pharmacyId, status ?? null],
  );
  const sessions = result.rows.map(mapSession);
  if (sessions.length === 0) return [];
  const sessionIds = sessions.map((session) => session.id);
  const lines = await readLines(client, pharmacyId, sessionIds);
  const currentBalances = await readCurrentBalances(
    client,
    pharmacyId,
    lines.map((line) => line.record.productId),
  );
  const linesBySession = new Map<string, CountLineWithApplication[]>();
  for (const line of lines) {
    const sessionLines = linesBySession.get(line.sessionId) ?? [];
    sessionLines.push(line.record);
    linesBySession.set(line.sessionId, sessionLines);
  }
  return sessions.map((session) => ({
    currentBalances,
    lines: linesBySession.get(session.id) ?? [],
    session,
  }));
}

interface InternalCountLineWithSession {
  readonly sessionId: string;
  readonly record: CountLineWithApplication;
}

async function readSessionHeader(
  client: PoolClient,
  pharmacyId: string,
  sessionId: string,
): Promise<CountSessionRecord | undefined> {
  const result = await client.query<CountSessionRow>(
    `select id, status, version::text, number_value::text, number_year,
            started_at::text, started_by, device_id,
            completed_at::text, completed_by, updated_at::text, updated_by
     from inventory_count_sessions
     where pharmacy_id = $1 and id = $2`,
    [pharmacyId, sessionId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : mapSession(row);
}

async function readLines(
  client: PoolClient,
  pharmacyId: string,
  sessionIds: readonly string[],
): Promise<readonly InternalCountLineWithSession[]> {
  if (sessionIds.length === 0) return [];
  const result = await client.query<CountLineRow & { session_id: string }>(
    `select line.session_id, line.id, line.ordinal, line.product_id,
            line.item_display_name, line.inventory_unit_name, line.entries,
            line.entered_label, line.counted_quantity::text,
            line.balance_at_observation::text, line.variance_at_observation::text,
            line.blocked_quantity_at_observation::text,
            line.observed_at::text, line.observed_by, line.device_id,
            application.id as application_id,
            application.balance_before::text as application_balance_before,
            application.counted_quantity::text as application_counted_quantity,
            application.variance::text as application_variance,
            application.carrying_amount_fils::text as application_carrying_amount_fils,
            application.average_unit_cost_scaled::text as application_average_unit_cost_scaled,
            application.valuation_method as application_valuation_method,
            application.treatment as application_treatment,
            application.reason as application_reason,
            application.evidence as application_evidence,
            application.journal_entry_id as application_journal_entry_id,
            application.applied_at::text as application_applied_at,
            application.applied_by as application_applied_by,
            application.device_id as application_device_id,
            movement_ids.ids as movement_ids
     from inventory_count_lines line
     left join inventory_count_variance_applications application
       on application.pharmacy_id = line.pharmacy_id
      and application.line_id = line.id
     left join lateral (
       select array_agg(movement.id order by movement.occurred_at, movement.id)
                as ids
       from inventory_movements movement
       where movement.pharmacy_id = line.pharmacy_id
         and movement.source_document_type = 'count-session'
         and movement.source_document_id = line.session_id
         and movement.source_row_ordinal = line.ordinal
     ) movement_ids on true
     where line.pharmacy_id = $1 and line.session_id = any($2::uuid[])
     order by line.session_id, line.ordinal, line.id`,
    [pharmacyId, sessionIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    record: {
      ...lineFromRow(row),
      application: applicationFromRow(row),
      movementIds: row.movement_ids ?? [],
    },
  }));
}

async function readCurrentBalances(
  client: PoolClient,
  pharmacyId: string,
  productIds: readonly string[],
): Promise<ReadonlyMap<string, bigint>> {
  const uniqueProductIds = [...new Set(productIds)];
  if (uniqueProductIds.length === 0) return new Map();
  const result = await client.query<{ product_id: string; balance: string }>(
    `select product_id, coalesce(sum(quantity), 0)::text as balance
     from inventory_movements
     where pharmacy_id = $1 and product_id = any($2::uuid[])
     group by product_id`,
    [pharmacyId, uniqueProductIds],
  );
  return new Map(
    result.rows.map((row) => [row.product_id, BigInt(row.balance)]),
  );
}

export async function nextCountLineOrdinal(
  client: PoolClient,
  pharmacyId: string,
  sessionId: string,
): Promise<number> {
  const result = await client.query<{ ordinal: number }>(
    `select coalesce(max(ordinal), 0) + 1 as ordinal
     from inventory_count_lines
     where pharmacy_id = $1 and session_id = $2`,
    [pharmacyId, sessionId],
  );
  const ordinal = result.rows[0]?.ordinal;
  if (ordinal === undefined)
    throw new Error("The next count line ordinal was not found");
  return ordinal;
}

export async function insertCountLine(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly sessionId: string;
    readonly ordinal: number;
    readonly productId: string;
    readonly itemDisplayName: string;
    readonly inventoryUnitName: string;
    readonly entries: unknown;
    readonly enteredLabel: string;
    readonly countedQuantity: bigint;
    readonly balanceAtObservation: bigint;
    readonly varianceAtObservation: bigint;
    readonly blockedQuantityAtObservation: bigint;
    readonly observedBy: string;
    readonly deviceId: string;
  },
): Promise<CountLineRecord> {
  const result = await client.query<CountLineRow>(
    `insert into inventory_count_lines (
       pharmacy_id, session_id, ordinal, product_id, item_display_name,
       inventory_unit_name, entries, entered_label, counted_quantity,
       balance_at_observation, variance_at_observation,
       blocked_quantity_at_observation, observed_by, device_id
     ) values (
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::bigint, $10::bigint,
       $11::bigint, $12::bigint, $13, $14
     )
     returning id, ordinal, product_id, item_display_name, inventory_unit_name,
               entries, entered_label, counted_quantity::text,
               balance_at_observation::text, variance_at_observation::text,
               blocked_quantity_at_observation::text, observed_at::text,
               observed_by, device_id`,
    [
      input.pharmacyId,
      input.sessionId,
      input.ordinal,
      input.productId,
      input.itemDisplayName,
      input.inventoryUnitName,
      JSON.stringify(input.entries),
      input.enteredLabel,
      input.countedQuantity.toString(),
      input.balanceAtObservation.toString(),
      input.varianceAtObservation.toString(),
      input.blockedQuantityAtObservation.toString(),
      input.observedBy,
      input.deviceId,
    ],
  );
  const row = result.rows[0];
  if (row === undefined)
    throw new Error("The Inventory Count Line was not created");
  return lineFromRow(row);
}

export async function readCountLine(
  client: PoolClient,
  pharmacyId: string,
  sessionId: string,
  lineId: string,
): Promise<CountLineRecord | undefined> {
  const result = await client.query<CountLineRow>(
    `select id, ordinal, product_id, item_display_name, inventory_unit_name,
            entries, entered_label, counted_quantity::text,
            balance_at_observation::text, variance_at_observation::text,
            blocked_quantity_at_observation::text, observed_at::text,
            observed_by, device_id
     from inventory_count_lines
     where pharmacy_id = $1 and session_id = $2 and id = $3`,
    [pharmacyId, sessionId, lineId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : lineFromRow(row);
}

export async function readCountApplication(
  client: PoolClient,
  pharmacyId: string,
  sessionId: string,
  lineId: string,
): Promise<CountApplicationRecord | undefined> {
  const result = await client.query<CountLineRow>(
    `select application.id as application_id,
            application.balance_before::text as application_balance_before,
            application.counted_quantity::text as application_counted_quantity,
            application.variance::text as application_variance,
            application.carrying_amount_fils::text as application_carrying_amount_fils,
            application.average_unit_cost_scaled::text as application_average_unit_cost_scaled,
            application.valuation_method as application_valuation_method,
            application.treatment as application_treatment,
            application.reason as application_reason,
            application.evidence as application_evidence,
            application.journal_entry_id as application_journal_entry_id,
            application.applied_at::text as application_applied_at,
            application.applied_by as application_applied_by,
            application.device_id as application_device_id
     from inventory_count_variance_applications application
     where application.pharmacy_id = $1
       and application.session_id = $2
       and application.line_id = $3`,
    [pharmacyId, sessionId, lineId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : (applicationFromRow(row) ?? undefined);
}

export async function insertCountVarianceApplication(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly sessionId: string;
    readonly lineId: string;
    readonly productId: string;
    readonly balanceBefore: bigint;
    readonly countedQuantity: bigint;
    readonly variance: bigint;
    readonly carryingAmountFils: bigint;
    readonly averageUnitCostScaled: bigint;
    readonly valuationMethod: "weighted-average-cost";
    readonly treatment: string;
    readonly reason: string;
    readonly evidence: string;
    readonly journalEntryId: string;
    readonly appliedBy: string;
    readonly deviceId: string;
  },
): Promise<CountApplicationRecord> {
  const result = await client.query<CountLineRow>(
    `insert into inventory_count_variance_applications (
       pharmacy_id, session_id, line_id, product_id, balance_before,
       counted_quantity, variance, carrying_amount_fils,
       average_unit_cost_scaled, valuation_method, treatment, reason, evidence,
       journal_entry_id, applied_by, device_id
     ) values (
       $1, $2, $3, $4, $5::bigint, $6::bigint, $7::bigint, $8::bigint,
       $9::numeric, $10, $11, $12, $13, $14, $15, $16
     )
     returning id, balance_before::text as application_balance_before,
               counted_quantity::text as application_counted_quantity,
               variance::text as application_variance,
               carrying_amount_fils::text as application_carrying_amount_fils,
               average_unit_cost_scaled::text as application_average_unit_cost_scaled,
               valuation_method as application_valuation_method,
               treatment as application_treatment, reason as application_reason,
               evidence as application_evidence,
               journal_entry_id as application_journal_entry_id,
               applied_at::text as application_applied_at,
               applied_by as application_applied_by, device_id as application_device_id`,
    [
      input.pharmacyId,
      input.sessionId,
      input.lineId,
      input.productId,
      input.balanceBefore.toString(),
      input.countedQuantity.toString(),
      input.variance.toString(),
      input.carryingAmountFils.toString(),
      input.averageUnitCostScaled.toString(),
      input.valuationMethod,
      input.treatment,
      input.reason,
      input.evidence,
      input.journalEntryId,
      input.appliedBy,
      input.deviceId,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("The Inventory Count Variance Application was not created");
  }
  const application = applicationFromRow(row);
  if (application === null) {
    throw new Error("The Inventory Count Variance Application was incomplete");
  }
  return application;
}

export async function recordCountVarianceMovement(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly productId: string;
    readonly batchId: string;
    readonly quantity: bigint;
    readonly carryingAmountFils: bigint;
    readonly sourceDocumentId: string;
    readonly sourceRowOrdinal: number;
    readonly actorId: string;
  },
): Promise<{ readonly movementId: string }> {
  if (input.quantity === 0n) {
    throw new RangeError("A count variance movement quantity cannot be zero");
  }
  const result = await client.query<{ id: string }>(
    `insert into inventory_movements (
       pharmacy_id, product_id, batch_id, reason, quantity, carrying_amount_fils,
       source_document_type, source_document_id, source_row_ordinal, created_by
     ) values ($1, $2, $3, 'count-variance', $4::bigint, $5::bigint,
               'count-session', $6, $7, $8)
     returning id`,
    [
      input.pharmacyId,
      input.productId,
      input.batchId,
      input.quantity.toString(),
      input.carryingAmountFils.toString(),
      input.sourceDocumentId,
      input.sourceRowOrdinal,
      input.actorId,
    ],
  );
  const movementId = result.rows[0]?.id;
  if (movementId === undefined)
    throw new Error("The Count Variance movement was not created");
  return { movementId };
}

export async function lockOrCreateValuationState(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
): Promise<InventoryValuationState> {
  await client.query(
    `insert into inventory_valuation_state (pharmacy_id, product_id)
     values ($1, $2)
     on conflict (pharmacy_id, product_id) do nothing`,
    [pharmacyId, productId],
  );
  const result = await client.query<{
    total_quantity: string;
    total_value_scaled: string;
  }>(
    `select total_quantity::text, total_value_scaled::text
     from inventory_valuation_state
     where pharmacy_id = $1 and product_id = $2
     for update`,
    [pharmacyId, productId],
  );
  const row = result.rows[0];
  if (row === undefined)
    throw new Error("The Inventory valuation state was not locked");
  return {
    totalQuantity: BigInt(row.total_quantity),
    totalValueScaled: BigInt(row.total_value_scaled),
  };
}

export async function writeValuationState(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
  state: InventoryValuationState,
): Promise<void> {
  await client.query(
    `update inventory_valuation_state
     set total_quantity = $3::bigint, total_value_scaled = $4::numeric,
         updated_at = statement_timestamp()
     where pharmacy_id = $1 and product_id = $2`,
    [
      pharmacyId,
      productId,
      state.totalQuantity.toString(),
      state.totalValueScaled.toString(),
    ],
  );
}

export async function deriveProductBalance(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
): Promise<bigint> {
  const result = await client.query<{ balance: string }>(
    `select coalesce(sum(quantity), 0)::text as balance
     from inventory_movements
     where pharmacy_id = $1 and product_id = $2`,
    [pharmacyId, productId],
  );
  const balance = result.rows[0]?.balance;
  if (balance === undefined)
    throw new Error("The product balance was not derived");
  return BigInt(balance);
}

export async function setCountSessionNumber(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly sessionId: string;
    readonly value: bigint;
    readonly year: number;
    readonly updatedBy: string;
  },
): Promise<string> {
  const result = await client.query<{ version: string }>(
    `update inventory_count_sessions
     set number_value = $3::bigint, number_year = $4,
         version = version + 1, updated_at = statement_timestamp(), updated_by = $5
     where pharmacy_id = $1 and id = $2 and number_value is null
     returning version::text`,
    [
      input.pharmacyId,
      input.sessionId,
      input.value.toString(),
      input.year,
      input.updatedBy,
    ],
  );
  const version = result.rows[0]?.version;
  if (version === undefined)
    throw new Error("The Count Session number was not set");
  return version;
}

export async function advanceCountSession(
  client: PoolClient,
  pharmacyId: string,
  sessionId: string,
  updatedBy: string,
): Promise<string> {
  const result = await client.query<{ version: string }>(
    `update inventory_count_sessions
     set version = version + 1, updated_at = statement_timestamp(), updated_by = $3
     where pharmacy_id = $1 and id = $2
     returning version::text`,
    [pharmacyId, sessionId, updatedBy],
  );
  const version = result.rows[0]?.version;
  if (version === undefined)
    throw new Error("The Count Session version was not advanced");
  return version;
}

export async function completeCountSession(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly sessionId: string;
    readonly completedBy: string;
    readonly updatedBy: string;
  },
): Promise<CountSessionRecord> {
  const result = await client.query<CountSessionRow>(
    `update inventory_count_sessions
     set status = 'completed', completed_at = statement_timestamp(),
         completed_by = $3, version = version + 1,
         updated_at = statement_timestamp(), updated_by = $4
     where pharmacy_id = $1 and id = $2 and status = 'active'
     returning id, status, version::text, number_value::text, number_year,
               started_at::text, started_by, device_id,
               completed_at::text, completed_by, updated_at::text, updated_by`,
    [input.pharmacyId, input.sessionId, input.completedBy, input.updatedBy],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("The Count Session was not completed");
  return mapSession(row);
}

export async function resolveCountSessionReferences(
  client: PoolClient,
  pharmacyId: string,
  sessionIds: readonly string[],
): Promise<ReadonlyMap<string, CountSessionReference>> {
  if (sessionIds.length === 0) return new Map();
  const result = await client.query<SessionReferenceRow>(
    `select session.id, session.number_value::text, session.number_year,
            session.started_at::text, line.ordinal
     from inventory_count_sessions session
     left join inventory_count_lines line
       on line.pharmacy_id = session.pharmacy_id
      and line.session_id = session.id
     where session.pharmacy_id = $1 and session.id = any($2::uuid[])
     order by session.id, line.ordinal`,
    [pharmacyId, sessionIds],
  );
  const references = new Map<
    string,
    {
      number: CountSessionReference["number"];
      labels: Map<number, string>;
    }
  >();
  for (const row of result.rows) {
    const reference = references.get(row.id) ?? {
      labels: new Map<number, string>(),
      number:
        row.number_value === null || row.number_year === null
          ? null
          : {
              series: "C" as const,
              value: row.number_value,
              year: row.number_year,
            },
    };
    if (row.ordinal !== null) {
      reference.labels.set(
        row.ordinal,
        reference.number === null
          ? `Count session started ${row.started_at} · line ${row.ordinal}`
          : `C${reference.number.value}/${reference.number.year} · line ${row.ordinal}`,
      );
    }
    references.set(row.id, reference);
  }
  return references;
}

export async function readCountVarianceJournals(
  client: PoolClient,
  pharmacyId: string,
  entryIds: readonly string[],
): Promise<ReadonlyMap<string, CountJournalRecord>> {
  if (entryIds.length === 0) return new Map();
  const result = await client.query<CountJournalRow>(
    `select entry.id as entry_id, entry.template_id, entry.template_version,
            line.ordinal, line.account_code, line.supplier_id,
            line.debit_fils::text, line.credit_fils::text
     from accounting_journal_entries entry
     join accounting_journal_lines line
       on line.pharmacy_id = entry.pharmacy_id and line.entry_id = entry.id
     where entry.pharmacy_id = $1 and entry.id = any($2::uuid[])
     order by entry.id, line.ordinal`,
    [pharmacyId, entryIds],
  );
  const journals = new Map<string, CountJournalRecord>();
  for (const row of result.rows) {
    const current = journals.get(row.entry_id);
    const line: CountJournalLineRecord = {
      accountCode: row.account_code,
      creditFils: row.credit_fils,
      debitFils: row.debit_fils,
      ordinal: row.ordinal,
      supplierId: row.supplier_id,
    };
    journals.set(
      row.entry_id,
      current === undefined
        ? {
            entryId: row.entry_id,
            lines: [line],
            templateId: row.template_id,
            templateVersion: row.template_version,
          }
        : { ...current, lines: [...current.lines, line] },
    );
  }
  return journals;
}

function mapSession(row: CountSessionRow): CountSessionRecord {
  return {
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    deviceId: row.device_id,
    id: row.id,
    numberValue: row.number_value,
    numberYear: row.number_year,
    startedAt: row.started_at,
    startedBy: row.started_by,
    status: row.status,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    version: row.version,
  };
}

function lineFromRow(row: CountLineRow): CountLineRecord {
  return {
    balanceAtObservation: row.balance_at_observation,
    blockedQuantityAtObservation: row.blocked_quantity_at_observation,
    countedQuantity: row.counted_quantity,
    deviceId: row.device_id,
    entries: row.entries,
    enteredLabel: row.entered_label,
    id: row.id,
    inventoryUnitName: row.inventory_unit_name,
    itemDisplayName: row.item_display_name,
    observedAt: row.observed_at,
    observedBy: row.observed_by,
    ordinal: row.ordinal,
    productId: row.product_id,
    varianceAtObservation: row.variance_at_observation,
  };
}

function applicationFromRow(row: CountLineRow): CountApplicationRecord | null {
  if (
    row.application_id === null ||
    row.application_balance_before === null ||
    row.application_counted_quantity === null ||
    row.application_variance === null ||
    row.application_carrying_amount_fils === null ||
    row.application_average_unit_cost_scaled === null ||
    row.application_valuation_method === null ||
    row.application_treatment === null ||
    row.application_reason === null ||
    row.application_evidence === null ||
    row.application_journal_entry_id === null ||
    row.application_applied_at === null ||
    row.application_applied_by === null ||
    row.application_device_id === null
  ) {
    return null;
  }
  return {
    appliedAt: row.application_applied_at,
    appliedBy: row.application_applied_by,
    averageUnitCostScaled: row.application_average_unit_cost_scaled,
    balanceBefore: row.application_balance_before,
    carryingAmountFils: row.application_carrying_amount_fils,
    countedQuantity: row.application_counted_quantity,
    deviceId: row.application_device_id,
    evidence: row.application_evidence,
    id: row.application_id,
    journalEntryId: row.application_journal_entry_id,
    reason: row.application_reason,
    treatment: row.application_treatment,
    valuationMethod: row.application_valuation_method,
    variance: row.application_variance,
  };
}
