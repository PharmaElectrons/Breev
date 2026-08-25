import { LOCAL_SECURITY_DENIAL_CODES } from "@breev/contracts/local-rest";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  type AnyPgColumn,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const mainDeviceDenialCode = pgEnum(
  "main_device_denial_code",
  LOCAL_SECURITY_DENIAL_CODES,
);
export const mainDeviceRequestClass = pgEnum("main_device_request_class", [
  "cors-preflight",
  "other-state-change",
  "proof-mutation",
]);
export const mainDeviceContext = pgEnum("main_device_context", [
  "missing",
  "present",
  "verified",
]);
export const mainDeviceRateAction = pgEnum("main_device_rate_action", [
  "proof-mutation",
]);

export const mainDevices = pgTable(
  "main_devices",
  {
    id: uuid().primaryKey(),
    credentialHash: bytea("credential_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("main_devices_id_uuidv7", uuidV7Check(table.id)),
    check(
      "main_devices_credential_hash_length",
      sql`octet_length(${table.credentialHash}) = 32`,
    ),
  ],
);

export const mainDeviceSessions = pgTable(
  "main_device_sessions",
  {
    tokenHash: bytea("token_hash").primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => mainDevices.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "main_device_sessions_token_hash_length",
      sql`octet_length(${table.tokenHash}) = 32`,
    ),
  ],
);

export const mainDeviceProofState = pgTable(
  "main_device_proof_state",
  {
    singleton: boolean().default(true).primaryKey(),
    mutationCount: bigint("mutation_count", { mode: "bigint" })
      .default(0n)
      .notNull(),
  },
  (table) => [
    check("main_device_proof_state_singleton", sql`${table.singleton} = true`),
    check(
      "main_device_proof_state_non_negative",
      sql`${table.mutationCount} >= 0`,
    ),
  ],
);

export const mainDeviceDenialTotals = pgTable(
  "main_device_denial_totals",
  {
    code: mainDeviceDenialCode().primaryKey(),
    denialCount: bigint("denial_count", { mode: "bigint" })
      .default(0n)
      .notNull(),
    lastDeniedAt: timestamp("last_denied_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "main_device_denial_totals_non_negative",
      sql`${table.denialCount} >= 0`,
    ),
  ],
);

export const mainDeviceRecentDenials = pgTable(
  "main_device_recent_denials",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    deniedAt: timestamp("denied_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    code: mainDeviceDenialCode().notNull(),
    requestClass: mainDeviceRequestClass("request_class").notNull(),
    deviceContext: mainDeviceContext("device_context").notNull(),
    deviceId: uuid("device_id").references(() => mainDevices.id),
  },
  (table) => [
    check("main_device_recent_denials_id_uuidv7", uuidV7Check(table.id)),
  ],
);

export const mainDeviceRateWindows = pgTable(
  "main_device_rate_windows",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => mainDevices.id),
    action: mainDeviceRateAction().notNull(),
    windowNumber: bigint("window_number", { mode: "bigint" }).notNull(),
    requestCount: integer("request_count").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.action, table.windowNumber] }),
    check(
      "main_device_rate_windows_positive_count",
      sql`${table.requestCount} > 0`,
    ),
  ],
);

function uuidV7Check(column: AnyPgColumn) {
  return sql`${column}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`;
}
