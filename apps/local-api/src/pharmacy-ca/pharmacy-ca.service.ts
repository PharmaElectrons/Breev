import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { LocalDatabaseService } from "../local-database.service.js";
import {
  createPersistedKeyPair,
  openPersistedKey,
  selectKeyStorageProvider,
  type CngKeyHandle,
} from "./cng-addon.js";
import {
  buildCACertificate,
  buildDeviceCertificate,
  buildServerCertificate,
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

@Injectable()
export class PharmacyCaService {
  private state: PharmacyCaState | undefined;

  public constructor(private readonly localDatabase: LocalDatabaseService) {}

  public async initializeCA(): Promise<void> {
    const pool = this.localDatabase.requirePool();
    const existing = await pool.query<{
      installation_id: string;
      ca_certificate: string;
      ca_fingerprint: string;
      provider_name: string;
      assurance_level: "platform-tpm" | "software-cng-fallback";
    }>(
      `select installation_id, ca_certificate, ca_fingerprint,
              provider_name, assurance_level
       from pharmacy_ca
       where singleton = true`,
    );

    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      let keyResult: { keyHandle: CngKeyHandle; publicKeyDer: Buffer };
      try {
        keyResult = openPersistedKey({
          providerName: row.provider_name,
          keyName: caKeyName(row.installation_id),
        });
      } catch (error) {
        throw Object.assign(
          new Error(
            "The pharmacy CA private key is inaccessible. " +
              "Repair is required — the CA cannot be silently replaced. " +
              `Provider: ${row.provider_name}, key: ${caKeyName(row.installation_id)}`,
          ),
          { code: "PHARMACY_CA_KEY_INACCESSIBLE", cause: error },
        );
      }
      this.state = {
        keyHandle: keyResult.keyHandle,
        publicKeyDer: keyResult.publicKeyDer,
        caCertPem: row.ca_certificate,
        installationId: row.installation_id,
        providerName: row.provider_name,
        assuranceLevel: row.assurance_level,
      };
      return;
    }

    const { providerName, assuranceLevel } = selectKeyStorageProvider();
    const installationId = randomUUID();

    const keyResult = createPersistedKeyPair({
      providerName,
      keyName: caKeyName(installationId),
      algorithm: "RSA",
      keyBits: 2048,
    });

    const issued = buildCACertificate({
      keyHandle: keyResult.keyHandle,
      publicKeyDer: keyResult.publicKeyDer,
      installationId,
      validityDays: CA_VALIDITY_DAYS,
    });

    await pool.query(
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

    this.state = {
      keyHandle: keyResult.keyHandle,
      publicKeyDer: keyResult.publicKeyDer,
      caCertPem: issued.certPem,
      installationId,
      providerName,
      assuranceLevel,
    };
  }

  public async issueServerCertificate(
    sanIPs: readonly string[],
  ): Promise<ServerTlsCredentials> {
    const state = this.requireState();
    const pool = this.localDatabase.requirePool();

    const issued: IssuedLeafCertificate = buildServerCertificate({
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

  public async issueDeviceCertificate(params: {
    readonly deviceId: string;
    readonly devicePublicKeyDer: Buffer;
  }): Promise<IssuedCertificate> {
    const state = this.requireState();
    const pool = this.localDatabase.requirePool();

    const issued = buildDeviceCertificate({
      caKeyHandle: state.keyHandle,
      caCertPem: state.caCertPem,
      deviceId: params.deviceId,
      installationId: state.installationId,
      devicePublicKeyDer: params.devicePublicKeyDer,
      validityDays: DEVICE_CERT_VALIDITY_DAYS,
    });

    await pool.query(
      `insert into terminal_devices
         (id, installation_id, cert_fingerprint, cert_serial,
          cert_not_before, cert_not_after)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update
         set cert_fingerprint = excluded.cert_fingerprint,
             cert_serial      = excluded.cert_serial,
             cert_not_before  = excluded.cert_not_before,
             cert_not_after   = excluded.cert_not_after`,
      [
        params.deviceId,
        state.installationId,
        issued.fingerprint,
        issued.serialHex,
        issued.notBefore,
        issued.notAfter,
      ],
    );

    return issued;
  }

  public validateCertificate(
    certDer: Buffer,
    expectedRole: CertRole,
    now?: Date,
  ): CertValidationResult {
    const state = this.requireState();
    return validateCertificate({
      certDer,
      caCertPem: state.caCertPem,
      expectedRole,
      installationId: state.installationId,
      now,
    });
  }

  public async checkDeviceRevocation(
    deviceId: string,
  ): Promise<{ revoked: true; reason: string } | { revoked: false }> {
    const pool = this.localDatabase.requirePool();
    const result = await pool.query<{
      revoked_at: Date | null;
      revocation_reason: string | null;
    }>(
      `select revoked_at, revocation_reason
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
    return { revoked: false };
  }

  public async revokeDevice(deviceId: string, reason: string): Promise<void> {
    const pool = this.localDatabase.requirePool();
    await pool.query(
      `update terminal_devices
       set revoked_at = statement_timestamp(),
           revocation_reason = $2
       where id = $1`,
      [deviceId, reason],
    );
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
}
