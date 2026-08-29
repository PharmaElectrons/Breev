/**
 * Seeds only synthetic pairing prerequisites into a disposable proof database.
 *
 * This runs as `breev_schema_owner`, never as the application role. It mirrors
 * the complete fixture chain in
 * `apps/local-api/src/devices/test-helpers/devices-fixture.test.ts:19-149`, then
 * adds the approved `devices.pairing.start` Step-Up the real HTTP route consumes.
 * Unlike the narrow fixture helper, the encoded licence is genuinely signed:
 * the built API still executes its production parser, signature verification,
 * entitlement derivation, and seat checks.
 */

import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SYNTHETIC_IDS = Object.freeze({
  challengeId: "019d0000-0000-7000-8000-000000000128",
  identitySessionId: "019d0000-0000-7000-8000-000000000126",
  licenceId: "019d0000-0000-7000-8000-000000000127",
  operatorId: "019d0000-0000-7000-8000-000000000125",
  ownerRoleId: "019d0000-0000-7000-8000-000000000124",
  pharmacyId: "019d0000-0000-7000-8000-000000000123",
});

export const SYNTHETIC_ISSUER_KEY_ID = "breev-m1-mtls-synthetic";
export const ISSUER_PUBLIC_KEYS_FILE = "licence-public-keys.json";
export const ISSUER_PRIVATE_KEY_FILE = "licence-signing-key.pem";

const SYNTHETIC_PHARMACY_NAME = "Breev M1 mTLS Synthetic Pharmacy";
const SYNTHETIC_USERNAME = "m1.mtls.synthetic";
const PERMITTED_DEVICE_COUNT = 4;

export async function prepareSyntheticIssuer(issuerDirectory) {
  const directory = path.resolve(issuerDirectory);
  const publicKeysPath = path.join(directory, ISSUER_PUBLIC_KEYS_FILE);
  const privateKeyPath = path.join(directory, ISSUER_PRIVATE_KEY_FILE);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const existing = JSON.parse(await readFile(publicKeysPath, "utf8"));
    assertIssuerRegistry(existing);
    return { privateKeyPath, publicKeysPath, reused: true };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const keys = generateKeyPairSync("ed25519");
  const publicKeyPem = keys.publicKey.export({ format: "pem", type: "spki" });
  const privateKeyPem = keys.privateKey.export({
    format: "pem",
    type: "pkcs8",
  });
  await writeFile(
    publicKeysPath,
    `${JSON.stringify({ [SYNTHETIC_ISSUER_KEY_ID]: publicKeyPem }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await writeFile(privateKeyPath, privateKeyPem, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { privateKeyPath, publicKeysPath, reused: false };
}

export async function seedPairingPrerequisites(options) {
  const databaseUrl = await readDatabaseUrl(options);
  assertDisposableDatabaseEndpoint(databaseUrl);
  const provisioning = JSON.parse(
    await readFile(path.resolve(options.mainDeviceFile), "utf8"),
  );
  assertProvisioning(provisioning);
  const issuerDirectory = path.resolve(options.issuerDirectory);
  const issuerRegistry = JSON.parse(
    await readFile(path.join(issuerDirectory, ISSUER_PUBLIC_KEYS_FILE), "utf8"),
  );
  assertIssuerRegistry(issuerRegistry);

  const requireFromLocalApi = createRequire(
    path.join(path.resolve(options.pgPackageRoot), "package.json"),
  );
  const { Client } = requireFromLocalApi("pg");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = await client.query(
      "select current_user, rolsuper from pg_roles where rolname = current_user",
    );
    if (
      identity.rows[0]?.current_user !== "breev_schema_owner" ||
      identity.rows[0]?.rolsuper !== false
    ) {
      throw new Error(
        "Pairing prerequisites must run as non-superuser breev_schema_owner",
      );
    }

    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(165308864)");
      const deviceSessionHash = createHash("sha256")
        .update(provisioning.sessionToken, "utf8")
        .digest();
      await assertMainBinding(client, provisioning.deviceId, deviceSessionHash);
      await seedPharmacy(client);
      await seedOperator(client);
      await seedIdentitySession(
        client,
        provisioning.deviceId,
        deviceSessionHash,
      );
      const encodedLicence = await existingOrMintedLicence(
        client,
        issuerDirectory,
        issuerRegistry[SYNTHETIC_ISSUER_KEY_ID],
        provisioning.deviceId,
      );
      await seedLicence(client, encodedLicence, provisioning.deviceId);
      await seedApprovedChallenge(
        client,
        provisioning.deviceId,
        deviceSessionHash,
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }

    const ca = await client.query(
      "select ca_certificate from pharmacy_ca where singleton = true",
    );
    const caCertificatePem = ca.rows[0]?.ca_certificate;
    if (typeof caCertificatePem !== "string") {
      throw new Error(
        "The LAN API must initialize its pharmacy CA before prerequisite seeding finishes",
      );
    }

    const outputDirectory = path.resolve(options.outputDirectory);
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    const caPath = path.join(outputDirectory, "ca-certificate.pem");
    const resultPath = path.join(outputDirectory, "seed-result.json");
    await writeFile(caPath, caCertificatePem, {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(
      resultPath,
      `${JSON.stringify(
        {
          challengeId: SYNTHETIC_IDS.challengeId,
          identitySessionId: SYNTHETIC_IDS.identitySessionId,
          licenceId: SYNTHETIC_IDS.licenceId,
          operatorId: SYNTHETIC_IDS.operatorId,
          permittedDeviceCount: PERMITTED_DEVICE_COUNT,
          pharmacyId: SYNTHETIC_IDS.pharmacyId,
          schemaVersion: 1,
          synthetic: true,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    return { caPath, resultPath };
  } finally {
    await client.end();
  }
}

async function assertMainBinding(client, mainDeviceId, deviceSessionHash) {
  const result = await client.query(
    `select exists(
       select 1 from main_devices where id = $1
     ) as device_exists,
     exists(
       select 1 from main_device_sessions
       where device_id = $1 and token_hash = $2
     ) as session_exists`,
    [mainDeviceId, deviceSessionHash],
  );
  if (
    result.rows[0]?.device_exists !== true ||
    result.rows[0]?.session_exists !== true
  ) {
    throw new Error("The configured Main device binding is not provisioned");
  }
}

async function seedPharmacy(client) {
  const existing = await client.query("select id, name from pharmacies");
  if (existing.rowCount === 0) {
    await client.query("insert into pharmacies (id, name) values ($1, $2)", [
      SYNTHETIC_IDS.pharmacyId,
      SYNTHETIC_PHARMACY_NAME,
    ]);
    return;
  }
  if (
    existing.rowCount !== 1 ||
    existing.rows[0]?.id !== SYNTHETIC_IDS.pharmacyId ||
    existing.rows[0]?.name !== SYNTHETIC_PHARMACY_NAME
  ) {
    throw new Error(
      "Refusing to seed mTLS proof data into a non-synthetic pharmacy database",
    );
  }
}

async function seedOperator(client) {
  await client.query(
    `insert into pharmacy_roles (id, pharmacy_id, role_key)
     values ($1, $2, 'owner')
     on conflict (id) do nothing`,
    [SYNTHETIC_IDS.ownerRoleId, SYNTHETIC_IDS.pharmacyId],
  );
  await client.query(
    `insert into identity_users (
       id, pharmacy_id, username, username_key, display_name, role_id,
       password_hash, password_algorithm, password_version,
       password_memory_kib, password_iterations, password_parallelism
     ) values (
       $1, $2, $3, $3, 'M1 mTLS Synthetic Operator', $4,
       $5, 'argon2id', 19, 19456, 2, 1
     ) on conflict (id) do nothing`,
    [
      SYNTHETIC_IDS.operatorId,
      SYNTHETIC_IDS.pharmacyId,
      SYNTHETIC_USERNAME,
      SYNTHETIC_IDS.ownerRoleId,
      Buffer.alloc(64),
    ],
  );
  await client.query(
    `insert into role_permission_grants (
       pharmacy_id, role_id, permission_name, granted_by
     ) values ($1, $2, 'devices.pair', $3)
     on conflict (role_id, permission_name) do nothing`,
    [
      SYNTHETIC_IDS.pharmacyId,
      SYNTHETIC_IDS.ownerRoleId,
      SYNTHETIC_IDS.operatorId,
    ],
  );
  await client.query(
    `insert into pharmacy_settings (pharmacy_id, updated_by)
     values ($1, $2)
     on conflict (pharmacy_id) do nothing`,
    [SYNTHETIC_IDS.pharmacyId, SYNTHETIC_IDS.operatorId],
  );
  await client.query(
    `insert into attendance_presence (pharmacy_id, user_id)
     values ($1, $2)
     on conflict (pharmacy_id, user_id) do nothing`,
    [SYNTHETIC_IDS.pharmacyId, SYNTHETIC_IDS.operatorId],
  );
}

async function seedIdentitySession(client, mainDeviceId, deviceSessionHash) {
  const active = await client.query(
    `select id from identity_sessions
     where device_session_hash = $1 and revoked_at is null`,
    [deviceSessionHash],
  );
  if (
    active.rowCount !== 0 &&
    active.rows[0]?.id !== SYNTHETIC_IDS.identitySessionId
  ) {
    throw new Error(
      "Refusing to replace a non-synthetic active Main operator session",
    );
  }
  await client.query(
    `insert into identity_sessions (
       id, pharmacy_id, user_id, device_id, device_session_hash, expires_at
     ) values ($1, $2, $3, $4, $5, statement_timestamp() + interval '8 hours')
     on conflict (id) do update
     set expires_at = statement_timestamp() + interval '8 hours',
         revoked_at = null,
         revocation_reason = null`,
    [
      SYNTHETIC_IDS.identitySessionId,
      SYNTHETIC_IDS.pharmacyId,
      SYNTHETIC_IDS.operatorId,
      mainDeviceId,
      deviceSessionHash,
    ],
  );
}

async function existingOrMintedLicence(
  client,
  issuerDirectory,
  publicKeyPem,
  mainDeviceId,
) {
  const existing = await client.query(
    "select encoded_licence from licence_installations where licence_id = $1",
    [SYNTHETIC_IDS.licenceId],
  );
  if (existing.rows[0]?.encoded_licence !== undefined) {
    assertSyntheticLicence(
      existing.rows[0].encoded_licence,
      publicKeyPem,
      mainDeviceId,
    );
    return existing.rows[0].encoded_licence;
  }
  const privateKeyPem = await readFile(
    path.join(issuerDirectory, ISSUER_PRIVATE_KEY_FILE),
    "utf8",
  );
  const claims = licenceClaims(mainDeviceId);
  const payload = Buffer.from(JSON.stringify(claims), "utf8");
  const encoded = JSON.stringify({
    algorithm: "Ed25519",
    keyId: SYNTHETIC_ISSUER_KEY_ID,
    payload: payload.toString("base64url"),
    signature: sign(null, payload, privateKeyPem).toString("base64url"),
  });
  assertSyntheticLicence(encoded, publicKeyPem, mainDeviceId);
  return encoded;
}

async function seedLicence(client, encodedLicence, mainDeviceId) {
  const claims = licenceClaims(mainDeviceId);
  await client.query(
    `insert into licence_installations (
       licence_id, pharmacy_id, main_device_id, key_id, format_version, plan,
       features, founder_override_grants, permitted_device_count,
       issued_at, expires_at, grace_ends_at, encoded_licence, installed_by
     ) values (
       $1, $2, $3, $4, 1, 'professional',
       array['additional-device-pos']::text[], array[]::text[], $5,
       $6, $7, $8, $9, $10
     ) on conflict (licence_id) do nothing`,
    [
      SYNTHETIC_IDS.licenceId,
      SYNTHETIC_IDS.pharmacyId,
      mainDeviceId,
      SYNTHETIC_ISSUER_KEY_ID,
      PERMITTED_DEVICE_COUNT,
      claims.issuedAt,
      claims.expiresAt,
      claims.graceEndsAt,
      encodedLicence,
      SYNTHETIC_IDS.operatorId,
    ],
  );
  const latest = await client.query(
    `select event_kind, licence_id
     from licence_state_events
     where pharmacy_id = $1 and main_device_id = $2
     order by recorded_at desc, id desc limit 1`,
    [SYNTHETIC_IDS.pharmacyId, mainDeviceId],
  );
  if (
    latest.rows[0]?.event_kind !== "installed" ||
    latest.rows[0]?.licence_id !== SYNTHETIC_IDS.licenceId
  ) {
    await client.query(
      `insert into licence_state_events (
         pharmacy_id, main_device_id, event_kind, licence_id, actor_user_id,
         identity_session_id
       ) values ($1, $2, 'installed', $3, $4, $5)`,
      [
        SYNTHETIC_IDS.pharmacyId,
        mainDeviceId,
        SYNTHETIC_IDS.licenceId,
        SYNTHETIC_IDS.operatorId,
        SYNTHETIC_IDS.identitySessionId,
      ],
    );
  }
}

async function seedApprovedChallenge(client, mainDeviceId, deviceSessionHash) {
  const revision = await client.query(
    `select pharmacy.identity_revision::text as pharmacy_revision,
            identity_user.auth_revision::text as auth_revision,
            pharmacy_role.revision::text as role_revision
     from pharmacies pharmacy
     join identity_users identity_user on identity_user.id = $2
     join pharmacy_roles pharmacy_role on pharmacy_role.id = identity_user.role_id
     where pharmacy.id = $1`,
    [SYNTHETIC_IDS.pharmacyId, SYNTHETIC_IDS.operatorId],
  );
  const values = revision.rows[0];
  if (values === undefined) {
    throw new Error("The synthetic operator revision state is missing");
  }
  await client.query(
    `insert into step_up_challenges (
       id, pharmacy_id, actor_user_id, identity_session_id, device_id,
       device_session_hash, terminal_device_id, action_name,
       required_permission, subject_id, subject_revision,
       pharmacy_identity_revision, actor_auth_revision, role_revision,
       expires_at, status, resolved_at
     ) values (
       $1, $2, $3, $4, $5, $6, null, 'devices.pairing.start',
       'devices.pair', $2, $7, $7, $8, $9,
       statement_timestamp() + interval '5 minutes', 'approved',
       statement_timestamp()
     ) on conflict (id) do update
     set subject_revision = excluded.subject_revision,
         pharmacy_identity_revision = excluded.pharmacy_identity_revision,
         actor_auth_revision = excluded.actor_auth_revision,
         role_revision = excluded.role_revision,
         created_at = statement_timestamp(),
         expires_at = statement_timestamp() + interval '5 minutes',
         status = 'approved',
         resolved_at = statement_timestamp(),
         denial_code = null,
         consumed_at = null`,
    [
      SYNTHETIC_IDS.challengeId,
      SYNTHETIC_IDS.pharmacyId,
      SYNTHETIC_IDS.operatorId,
      SYNTHETIC_IDS.identitySessionId,
      mainDeviceId,
      deviceSessionHash,
      values.pharmacy_revision,
      values.auth_revision,
      values.role_revision,
    ],
  );
}

function licenceClaims(mainDeviceId) {
  return {
    formatVersion: 1,
    keyId: SYNTHETIC_ISSUER_KEY_ID,
    pharmacyId: SYNTHETIC_IDS.pharmacyId,
    mainDeviceId,
    plan: "professional",
    permittedDeviceCount: PERMITTED_DEVICE_COUNT,
    graceEndsAt: "2099-01-08T00:00:00.000Z",
    licenceId: SYNTHETIC_IDS.licenceId,
    features: ["additional-device-pos"],
    founderOverrideGrants: [],
    issuedAt: "2020-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

function assertSyntheticLicence(encoded, publicKeyPem, mainDeviceId) {
  const envelope = JSON.parse(encoded);
  const payload = Buffer.from(envelope.payload, "base64url");
  const signature = Buffer.from(envelope.signature, "base64url");
  if (
    envelope.algorithm !== "Ed25519" ||
    envelope.keyId !== SYNTHETIC_ISSUER_KEY_ID ||
    !verify(null, payload, createPublicKey(publicKeyPem), signature) ||
    JSON.stringify(JSON.parse(payload.toString("utf8"))) !==
      JSON.stringify(licenceClaims(mainDeviceId))
  ) {
    throw new Error("The stored synthetic licence does not match this proof");
  }
}

function assertIssuerRegistry(registry) {
  const publicKeyPem = registry?.[SYNTHETIC_ISSUER_KEY_ID];
  if (
    Object.keys(registry ?? {}).length !== 1 ||
    typeof publicKeyPem !== "string"
  ) {
    throw new Error("The synthetic issuer registry is malformed");
  }
  createPublicKey(publicKeyPem);
}

function assertProvisioning(provisioning) {
  if (
    typeof provisioning?.deviceId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      provisioning.deviceId,
    ) ||
    typeof provisioning.deviceSecret !== "string" ||
    typeof provisioning.sessionToken !== "string" ||
    ![provisioning.deviceSecret, provisioning.sessionToken].every(
      (value) =>
        /^[A-Za-z0-9_-]{43}$/u.test(value) &&
        Buffer.from(value, "base64url").length === 32,
    )
  ) {
    throw new Error("The Main device provisioning file is invalid");
  }
}

async function readDatabaseUrl(options) {
  if (options.databaseUrl !== undefined) {
    return options.databaseUrl;
  }
  return (await readFile(path.resolve(options.databaseUrlFile), "utf8")).trim();
}

function assertDisposableDatabaseEndpoint(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("The schema-owner URL is not PostgreSQL");
  }
  if (!["127.0.0.1", "::1", "localhost"].includes(parsed.hostname)) {
    throw new Error(
      "Synthetic pairing prerequisites may target only a loopback PostgreSQL endpoint",
    );
  }
}

function readArgument(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function main(argv) {
  const issuerDirectory = readArgument(argv, "--issuer-directory");
  if (issuerDirectory === undefined) {
    throw new Error("--issuer-directory is required");
  }
  if (argv.includes("--prepare-issuer")) {
    const result = await prepareSyntheticIssuer(issuerDirectory);
    process.stdout.write(`${result.publicKeysPath}\n`);
    return;
  }
  const databaseUrl = readArgument(argv, "--database-url");
  const databaseUrlFile = readArgument(argv, "--database-url-file");
  const mainDeviceFile = readArgument(argv, "--main-device-file");
  const outputDirectory = readArgument(argv, "--output-dir");
  const pgPackageRoot = readArgument(argv, "--pg-package-root");
  if (
    (databaseUrl === undefined) === (databaseUrlFile === undefined) ||
    mainDeviceFile === undefined ||
    outputDirectory === undefined ||
    pgPackageRoot === undefined
  ) {
    throw new Error(
      "Seed mode requires exactly one database URL source plus --main-device-file, --output-dir, and --pg-package-root",
    );
  }
  const result = await seedPairingPrerequisites({
    databaseUrl,
    databaseUrlFile,
    issuerDirectory,
    mainDeviceFile,
    outputDirectory,
    pgPackageRoot,
  });
  process.stdout.write(`${result.resultPath}\n`);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main(process.argv.slice(2));
}
