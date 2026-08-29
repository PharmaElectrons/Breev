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
 * A row here exists only as the outcome of a pairing ceremony, and nothing else
 * may create one: it names the pharmacy, the licence whose seat it holds, the
 * operator-chosen display name, the issued certificate, and who paired it. The
 * device private key is generated on the terminal and never stored here.
 *
 * This declaration is typed documentation of the live table, not a source the
 * migrations are generated from — Breev has no schema generator, and
 * `drizzle/0006_devices_pairing.sql` is authoritative. Foreign keys, composite
 * keys, and partial indexes are therefore declared there and not repeated here:
 * the tables they reference (pharmacies, identity_users, licence_installations,
 * pairing_sessions, seat_release_requests) are read through hand-written SQL and
 * have no Drizzle declaration to point at.
 */
export const terminalDevices = pgTable(
  "terminal_devices",
  {
    id: uuid().primaryKey(),
    installationId: uuid("installation_id").notNull(),
    pharmacyId: uuid("pharmacy_id").notNull(),
    displayName: text("display_name").notNull(),
    licenceId: uuid("licence_id").notNull(),
    certFingerprint: text("cert_fingerprint").notNull(),
    certSerial: text("cert_serial").notNull(),
    certNotBefore: timestamp("cert_not_before", {
      withTimezone: true,
    }).notNull(),
    certNotAfter: timestamp("cert_not_after", { withTimezone: true }).notNull(),
    certPem: text("cert_pem").notNull(),
    pairedAt: timestamp("paired_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    pairedBy: uuid("paired_by").notNull(),
    pairingSessionId: uuid("pairing_session_id").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
    revokedBy: uuid("revoked_by"),
    seatAllocatedAt: timestamp("seat_allocated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    seatReleasedAt: timestamp("seat_released_at", { withTimezone: true }),
    seatReleasedBy: uuid("seat_released_by"),
    seatReleaseRequestId: uuid("seat_release_request_id"),
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
    check(
      "terminal_devices_display_name_length",
      sql`char_length(${table.displayName}) BETWEEN 1 AND 64`,
    ),
    check(
      "terminal_devices_reason_length",
      sql`${table.revocationReason} IS NULL OR char_length(${table.revocationReason}) BETWEEN 1 AND 128`,
    ),
    check(
      "terminal_devices_cert_pem_nonempty",
      sql`char_length(${table.certPem}) BETWEEN 1 AND 16384`,
    ),
    check(
      "terminal_devices_validity_window",
      sql`${table.certNotBefore} < ${table.certNotAfter}`,
    ),
    check(
      "terminal_devices_revoked_by_consistent",
      sql`(${table.revokedAt} IS NULL) = (${table.revokedBy} IS NULL)`,
    ),
    check(
      "terminal_devices_seat_release_consistent",
      sql`(${table.seatReleasedAt} IS NULL) = (${table.seatReleasedBy} IS NULL)`,
    ),
    check(
      "terminal_devices_seat_release_after_revocation",
      sql`${table.seatReleasedAt} IS NULL OR ${table.revokedAt} IS NOT NULL`,
    ),
    check(
      "terminal_devices_seat_release_request_consistent",
      sql`(${table.seatReleasedAt} IS NULL) = (${table.seatReleaseRequestId} IS NULL)`,
    ),
  ],
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuidV7Check(column: AnyPgColumn) {
  return sql`${column}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`;
}
