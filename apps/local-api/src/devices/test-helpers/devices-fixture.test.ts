import type { Pool } from "pg";

import { createUuidV7 } from "../../pharmacy-ca/pharmacy-ca-crypto.js";
import type { PharmacyCaService } from "../../pharmacy-ca/pharmacy-ca.service.js";

/**
 * Shared PostgreSQL fixtures for the device seams. A terminal device record is
 * only legal when a pharmacy, an owner, a licence, and a pairing session exist
 * behind it, so tests that need one build the whole chain rather than a bare
 * row.
 */
export interface SeededPharmacy {
  readonly mainDeviceId: string;
  readonly ownerId: string;
  readonly ownerRoleId: string;
  readonly pharmacyId: string;
}

export async function seedPharmacy(
  pool: Pool,
  input: { readonly mainDeviceId: string; readonly name: string },
): Promise<SeededPharmacy> {
  const pharmacyId = createUuidV7();
  const ownerRoleId = createUuidV7();
  const ownerId = createUuidV7();
  await pool.query("insert into pharmacies (id, name) values ($1, $2)", [
    pharmacyId,
    input.name,
  ]);
  await pool.query(
    `insert into pharmacy_roles (id, pharmacy_id, role_key)
     values ($1, $2, 'owner')`,
    [ownerRoleId, pharmacyId],
  );
  await pool.query(
    `insert into identity_users (
       id, pharmacy_id, username, username_key, display_name, role_id,
       password_hash, password_algorithm, password_version,
       password_memory_kib, password_iterations, password_parallelism
     ) values ($1, $2, 'device.fixture', 'device.fixture', 'Device Fixture',
               $3, $4, 'argon2id', 19, 19456, 2, 1)`,
    [ownerId, pharmacyId, ownerRoleId, Buffer.alloc(64)],
  );
  return {
    mainDeviceId: input.mainDeviceId,
    ownerId,
    ownerRoleId,
    pharmacyId,
  };
}

export async function seedLicenceRow(
  pool: Pool,
  input: {
    readonly encodedLicence?: string;
    readonly mainDeviceId: string;
    readonly ownerId: string;
    readonly permittedDeviceCount?: number;
    readonly pharmacyId: string;
  },
): Promise<string> {
  const licenceId = createUuidV7();
  await pool.query(
    `insert into licence_installations (
       licence_id, pharmacy_id, main_device_id, key_id, format_version, plan,
       features, founder_override_grants, permitted_device_count,
       issued_at, expires_at, grace_ends_at, encoded_licence, installed_by
     ) values (
       $1, $2, $3, 'breev-test-ed25519-2026-01', 1, 'professional',
       array['additional-device-pos']::text[], array[]::text[], $4,
       '2020-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z',
       '2099-01-08T00:00:00.000Z', $5, $6
     )`,
    [
      licenceId,
      input.pharmacyId,
      input.mainDeviceId,
      input.permittedDeviceCount ?? 4,
      input.encodedLicence ?? "fixture-licence",
      input.ownerId,
    ],
  );
  return licenceId;
}

export async function seedPairingSession(
  pool: Pool,
  input: {
    readonly identitySessionId: string;
    readonly installationId: string;
    readonly mainDeviceId: string;
    readonly ownerId: string;
    readonly pharmacyId: string;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into pairing_sessions (
       pharmacy_id, installation_id, started_by_user_id, started_device_id,
       identity_session_id, state, join_secret_hash, max_join_attempts,
       bound_spki_der, bound_device_name, bound_at, confirmed_at, consumed_at,
       expires_at
     ) values (
       $1, $2, $3, $4, $5, 'confirmed', $6, 5, $7, 'Fixture Terminal',
       statement_timestamp(), statement_timestamp(), statement_timestamp(),
       statement_timestamp() + interval '5 minutes'
     ) returning id`,
    [
      input.pharmacyId,
      input.installationId,
      input.ownerId,
      input.mainDeviceId,
      input.identitySessionId,
      Buffer.alloc(32),
      Buffer.alloc(64),
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error("The fixture pairing session was not created");
  }
  return id;
}

export async function seedIdentitySession(
  pool: Pool,
  input: {
    readonly deviceSessionHash: Buffer;
    readonly mainDeviceId: string;
    readonly ownerId: string;
    readonly pharmacyId: string;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into identity_sessions (
       pharmacy_id, user_id, device_id, device_session_hash, expires_at
     ) values ($1, $2, $3, $4, statement_timestamp() + interval '8 hours')
     returning id`,
    [
      input.pharmacyId,
      input.ownerId,
      input.mainDeviceId,
      input.deviceSessionHash,
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error("The fixture identity session was not created");
  }
  return id;
}

/**
 * Signs a terminal device certificate and records the device exactly the way
 * the pairing confirmation does, so tests that only care about mTLS behavior do
 * not have to run the whole ceremony.
 */
export async function issueFixtureDeviceCertificate(
  pool: Pool,
  pharmacyCa: PharmacyCaService,
  input: {
    readonly devicePublicKeyDer: Buffer;
    readonly displayName?: string;
    readonly licenceId: string;
    readonly ownerId: string;
    readonly pairingSessionId: string;
    readonly pharmacyId: string;
  },
): Promise<{
  readonly certPem: string;
  readonly deviceId: string;
  readonly fingerprint: string;
}> {
  const deviceId = createUuidV7();
  const certificate = pharmacyCa.signDeviceCertificate({
    deviceId,
    devicePublicKeyDer: input.devicePublicKeyDer,
    licenceId: input.licenceId,
    pharmacyId: input.pharmacyId,
  });
  await pool.query(
    `insert into terminal_devices (
       id, installation_id, pharmacy_id, display_name, licence_id,
       cert_fingerprint, cert_serial, cert_not_before, cert_not_after,
       cert_pem, paired_by, pairing_session_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      deviceId,
      pharmacyCa.installationId,
      input.pharmacyId,
      input.displayName ?? "Fixture Terminal",
      input.licenceId,
      certificate.fingerprint,
      certificate.serialHex,
      certificate.notBefore,
      certificate.notAfter,
      certificate.certPem,
      input.ownerId,
      input.pairingSessionId,
    ],
  );
  await pool.query(
    "update pairing_sessions set terminal_device_id = $2 where id = $1",
    [input.pairingSessionId, deviceId],
  );
  return {
    certPem: certificate.certPem,
    deviceId,
    fingerprint: certificate.fingerprint,
  };
}

export async function revokeFixtureDevice(
  pool: Pool,
  input: {
    readonly actorId: string;
    readonly deviceId: string;
    readonly reason: string;
  },
): Promise<void> {
  await pool.query(
    `update terminal_devices
     set revoked_at = statement_timestamp(),
         revocation_reason = $2,
         revoked_by = $3
     where id = $1 and revoked_at is null`,
    [input.deviceId, input.reason, input.actorId],
  );
}
