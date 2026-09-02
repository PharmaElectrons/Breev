import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";

import { LocalDatabaseService } from "../local-database.service.js";
import {
  createPersistedKeyPair,
  deletePersistedKey,
  openPersistedKey,
  selectKeyStorageProvider,
  type CngKeyHandle,
} from "./cng-addon.js";
import {
  buildCACertificate,
  buildDeviceCertificate,
  buildServerCertificate,
  caCertificateMatches,
  createUuidV7,
  validateCertificate,
  type CertRole,
  type CertValidationResult,
  type IssuedCertificate,
  type IssuedLeafCertificate,
} from "./pharmacy-ca-crypto.js";

const CA_VALIDITY_DAYS = 365 * 10;
const SERVER_CERT_VALIDITY_DAYS = 365;
const DEVICE_CERT_VALIDITY_DAYS = 365;

function caKeyName(installationId: string): string {
  return `breev-pharmacy-ca-${installationId}`;
}

export interface PharmacyCaState {
  readonly keyHandle: CngKeyHandle;
  readonly publicKeyDer: Buffer;
  readonly caCertPem: string;
  readonly installationId: string;
  readonly providerName: string;
  readonly assuranceLevel: "platform-tpm" | "software-cng-fallback";
}

export interface ServerTlsCredentials {
  readonly certPem: string;
  readonly privateKeyPem: string;
  readonly caCertPem: string;
}

interface PersistedPharmacyCaRow {
  readonly installation_id: string;
  readonly ca_certificate: string;
  readonly ca_fingerprint: string;
  readonly provider_name: string;
  readonly assurance_level: "platform-tpm" | "software-cng-fallback";
}

export class PharmacyCaKeyStoreError extends Error {
  public readonly code = "PHARMACY_CA_KEY_STORE_UNAVAILABLE" as const;

  public constructor(
    message: string,
    public readonly installationId: string,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = "PharmacyCaKeyStoreError";
  }
}

@Injectable()
export class PharmacyCaService {
  private state: PharmacyCaState | undefined;

  public constructor(private readonly localDatabase: LocalDatabaseService) {}

  public async initializeCA(): Promise<void> {
    if (this.state !== undefined) {
      return;
    }
    const pool = this.localDatabase.requirePool();
    const client = await pool.connect();
    let createdKey: { keyName: string; providerName: string } | undefined;
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(165308857)");
      const existing = await client.query<PersistedPharmacyCaRow>(
        `select installation_id, ca_certificate, ca_fingerprint,
                provider_name, assurance_level
         from pharmacy_ca
         where singleton = true`,
      );

      if (existing.rowCount === 1) {
        const row = existing.rows[0]!;
        const state = await this.restoreState(row);
        await client.query("commit");
        this.state = state;
        return;
      }

      const { providerName, assuranceLevel } = await selectKeyStorageProvider();
      const installationId = createUuidV7();
      const keyIdentity = { providerName, keyName: caKeyName(installationId) };
      let keyResult: Awaited<ReturnType<typeof createPersistedKeyPair>>;
      try {
        keyResult = await createPersistedKeyPair({
          ...keyIdentity,
          algorithm: "RSA",
          keyBits: 2048,
        });
      } catch (error) {
        throw new PharmacyCaKeyStoreError(
          "The pharmacy CA key could not be created in Windows machine key storage.",
          installationId,
          error,
        );
      }
      // Rollback owns the key only after key storage confirms that it exists.
      createdKey = keyIdentity;
      let issued: IssuedCertificate;
      try {
        issued = await buildCACertificate({
          keyHandle: keyResult.keyHandle,
          publicKeyDer: keyResult.publicKeyDer,
          installationId,
          validityDays: CA_VALIDITY_DAYS,
        });
      } catch (error) {
        throw new PharmacyCaKeyStoreError(
          "The pharmacy CA key could not sign its certificate.",
          installationId,
          error,
        );
      }

      await client.query(
        `insert into pharmacy_ca
           (singleton, installation_id, ca_fingerprint, ca_certificate,
            provider_name, assurance_level)
         values (true, $1, $2, $3, $4, $5)`,
        [
          installationId,
          issued.fingerprint,
          issued.certPem,
          providerName,
          assuranceLevel,
        ],
      );
      await client.query("commit");
      createdKey = undefined;
      this.state = {
        keyHandle: keyResult.keyHandle,
        publicKeyDer: keyResult.publicKeyDer,
        caCertPem: issued.certPem,
        installationId,
        providerName,
        assuranceLevel,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (createdKey !== undefined) {
        await deletePersistedKey(createdKey);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Loads an existing installation identity without creating one. */
  public async loadExistingCA(): Promise<PharmacyCaState | undefined> {
    if (this.state !== undefined) {
      return this.state;
    }
    const existing = await this.localDatabase
      .requirePool()
      .query<PersistedPharmacyCaRow>(
        `select installation_id, ca_certificate, ca_fingerprint,
                provider_name, assurance_level
         from pharmacy_ca
         where singleton = true`,
      );
    const row = existing.rows[0];
    if (row === undefined) {
      return undefined;
    }
    const state = await this.restoreState(row);
    this.state = state;
    return state;
  }

  public async issueServerCertificate(
    sanIPs: readonly string[],
  ): Promise<ServerTlsCredentials> {
    const state = this.requireState();
    const pool = this.localDatabase.requirePool();

    const issued: IssuedLeafCertificate = await buildServerCertificate({
      caKeyHandle: state.keyHandle,
      caCertPem: state.caCertPem,
      installationId: state.installationId,
      sanIPs,
      validityDays: SERVER_CERT_VALIDITY_DAYS,
    });

    await pool.query(
      `insert into server_certificates
         (installation_id, cert_fingerprint, cert_not_before, cert_not_after)
       values ($1, $2, $3, $4)`,
      [
        state.installationId,
        issued.fingerprint,
        issued.notBefore,
        issued.notAfter,
      ],
    );

    return {
      certPem: issued.certPem,
      privateKeyPem: issued.privateKeyPem,
      caCertPem: state.caCertPem,
    };
  }

  /**
   * Signs a terminal device certificate and returns it. Nothing is written:
   * the device record, the seat, and the audit belong to the pairing
   * confirmation transaction, which owns the connection and the locks. Signing
   * is a local key operation with no network call, so it is safe to perform
   * while that transaction is open.
   */
  public async signDeviceCertificate(params: {
    readonly deviceId: string;
    readonly devicePublicKeyDer: Buffer;
    readonly licenceId: string;
    readonly pharmacyId: string;
  }): Promise<IssuedCertificate> {
    const state = this.requireState();
    return await buildDeviceCertificate({
      caCertPem: state.caCertPem,
      caKeyHandle: state.keyHandle,
      deviceId: params.deviceId,
      devicePublicKeyDer: params.devicePublicKeyDer,
      installationId: state.installationId,
      licenceId: params.licenceId,
      pharmacyId: params.pharmacyId,
      validityDays: DEVICE_CERT_VALIDITY_DAYS,
    });
  }

  /**
   * Refuses to certify a device identifier the installation already knows.
   *
   * A revoked terminal is never re-certified under its old identity, and a
   * live terminal never receives a second certificate: replacement creates a
   * new identity and a new key, and re-issuing here would silently restore
   * trust that an operator deliberately withdrew.
   */
  public async assertDeviceCertifiable(
    client: PoolClient,
    deviceId: string,
  ): Promise<void> {
    const existing = await client.query(
      "select 1 from terminal_devices where id = $1",
      [deviceId],
    );
    if (existing.rowCount !== 0) {
      throw new Error(
        "A terminal device certificate is issued once; replacement requires a new identity",
      );
    }
  }

  public validateCertificate(
    certDer: Buffer,
    expectedRole: CertRole,
    options?: {
      readonly expectedServerIp?: string;
      readonly now?: Date;
    },
  ): CertValidationResult {
    const state = this.requireState();
    return validateCertificate({
      certDer,
      caCertPem: state.caCertPem,
      expectedRole,
      expectedServerIp: options?.expectedServerIp,
      installationId: state.installationId,
      now: options?.now,
    });
  }

  public async checkDeviceRevocation(
    deviceId: string,
    fingerprint: string,
  ): Promise<{ revoked: true; reason: string } | { revoked: false }> {
    const pool = this.localDatabase.requirePool();
    const result = await pool.query<{
      revoked_at: Date | null;
      revocation_reason: string | null;
      cert_fingerprint: string | null;
    }>(
      `select revoked_at, revocation_reason, cert_fingerprint
       from terminal_devices
       where id = $1`,
      [deviceId],
    );
    const row = result.rows[0];
    if (row === undefined || row.revoked_at !== null) {
      return {
        revoked: true,
        reason: row?.revocation_reason ?? "device not registered",
      };
    }
    if (row.cert_fingerprint !== fingerprint) {
      return { revoked: true, reason: "certificate replaced" };
    }
    return { revoked: false };
  }

  public requireState(): PharmacyCaState {
    if (this.state === undefined) {
      throw new Error(
        "PharmacyCaService.initializeCA() must be called before using the CA",
      );
    }
    return this.state;
  }

  public get installationId(): string {
    return this.requireState().installationId;
  }

  public get caCertPem(): string {
    return this.requireState().caCertPem;
  }

  private async restoreState(
    row: PersistedPharmacyCaRow,
  ): Promise<PharmacyCaState> {
    let keyResult: { keyHandle: CngKeyHandle; publicKeyDer: Buffer };
    try {
      keyResult = await openPersistedKey({
        providerName: row.provider_name,
        keyName: caKeyName(row.installation_id),
      });
    } catch (error) {
      throw new PharmacyCaKeyStoreError(
        "The pharmacy CA private key is inaccessible. " +
          "Repair is required — the CA cannot be silently replaced. " +
          `Provider: ${row.provider_name}, key: ${caKeyName(row.installation_id)}`,
        row.installation_id,
        error,
      );
    }
    if (
      !caCertificateMatches({
        certPem: row.ca_certificate,
        fingerprint: row.ca_fingerprint,
        installationId: row.installation_id,
        publicKeyDer: keyResult.publicKeyDer,
      })
    ) {
      throw Object.assign(
        new Error(
          "The pharmacy CA certificate does not match its persisted key and installation identity.",
        ),
        { code: "PHARMACY_CA_IDENTITY_MISMATCH" },
      );
    }
    return {
      keyHandle: keyResult.keyHandle,
      publicKeyDer: keyResult.publicKeyDer,
      caCertPem: row.ca_certificate,
      installationId: row.installation_id,
      providerName: row.provider_name,
      assuranceLevel: row.assurance_level,
    };
  }
}
