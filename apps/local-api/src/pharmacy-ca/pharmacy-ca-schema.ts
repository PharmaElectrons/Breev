import { LOCAL_SECURITY_DENIAL_CODES } from "@breev/contracts/local-rest";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgEnum,
  pgTable,
  text,
  timestamp,
  type AnyPgColumn,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const pharmacyCaAssuranceLevel = pgEnum("pharmacy_ca_assurance_level", [
  "platform-tpm",
  "software-cng-fallback",
]);

/**
 * Extend the existing main_device_denial_code enum with CA/mTLS denial codes.
 * The enum is defined in the first migration; we ADD the new values in migration
 * 0001. We re-declare it here so Drizzle can reference it in the new tables.
 */
export const mainDeviceDenialCode = pgEnum(
  "main_device_denial_code",
  LOCAL_SECURITY_DENIAL_CODES,
);

// ─── Pharmacy CA ──────────────────────────────────────────────────────────────

/**
 * Singleton record created by secure first initialization.
 * Repair and reinstall never replace this row — they must find it and verify
 * the CNG key is still accessible, or fail closed.
 *
 * The CA private key is stored only in CNG machine key storage and is never
 * written here. Only the public certificate (PEM), its SHA-256 fingerprint,
 * the CNG provider, and the assurance level are stored.
 */
export const pharmacyCa = pgTable(
  "pharmacy_ca",
  {
    singleton: boolean().default(true).primaryKey(),
    installationId: uuid("installation_id").notNull(),
    caFingerprint: text("ca_fingerprint").notNull(),
    caCertificate: text("ca_certificate").notNull(),
    providerName: text("provider_name").notNull(),
    assuranceLevel: pharmacyCaAssuranceLevel("assurance_level").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("pharmacy_ca_singleton", sql`${table.singleton} = true`),
    check(
      "pharmacy_ca_installation_id_uuidv7",
      uuidV7Check(table.installationId),
    ),
    check(
      "pharmacy_ca_fingerprint_nonempty",
      sql`char_length(${table.caFingerprint}) > 0`,
    ),
    check(
      "pharmacy_ca_certificate_nonempty",
      sql`char_length(${table.caCertificate}) > 0`,
    ),
  ],
);

// ─── Server Certificates ──────────────────────────────────────────────────────

/**
 * Tracks the current server certificate. Immutable once issued — renewal
 * inserts a new row. The private key is held in-process only and is never
 * stored in the database.
 */
export const serverCertificates = pgTable(
  "server_certificates",
  {
    id: uuid()
      .default(sql`uuidv7()`)
      .primaryKey(),
    installationId: uuid("installation_id").notNull(),
    certFingerprint: text("cert_fingerprint").notNull(),
    certNotBefore: timestamp("cert_not_before", {
      withTimezone: true,
    }).notNull(),
    certNotAfter: timestamp("cert_not_after", {
      withTimezone: true,
    }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("server_certificates_id_uuidv7", uuidV7Check(table.id)),
    check(
      "server_certificates_installation_id_uuidv7",
      uuidV7Check(table.installationId),
    ),
    check(
      "server_certificates_validity_window",
      sql`${table.certNotBefore} < ${table.certNotAfter}`,
    ),
  ],
);

// ─── Terminal Devices ─────────────────────────────────────────────────────────

/**
 * Device registry. A device with revoked_at IS NOT NULL is revoked.
 * Every LAN request checks this record even on resumed TLS sessions
 * (per domain.md §Identity L70).
 *
 * The device private key is generated non-exported on the terminal side
 * during pairing (later issue) and never stored here.
 */
export const terminalDevices = pgTable(
  "terminal_devices",
  {
    id: uuid().primaryKey(),
    installationId: uuid("installation_id").notNull(),
    certFingerprint: text("cert_fingerprint"),
    certSerial: text("cert_serial"),
    certNotBefore: timestamp("cert_not_before", { withTimezone: true }),
    certNotAfter: timestamp("cert_not_after", { withTimezone: true }),
    pairedAt: timestamp("paired_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
  },
  (table) => [
    check("terminal_devices_id_uuidv7", uuidV7Check(table.id)),
    check(
      "terminal_devices_installation_id_uuidv7",
      uuidV7Check(table.installationId),
    ),
    check(
      "terminal_devices_revocation_consistent",
      sql`(${table.revokedAt} IS NULL) = (${table.revocationReason} IS NULL)`,
    ),
  ],
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuidV7Check(column: AnyPgColumn) {
  return sql`${column}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`;
}
