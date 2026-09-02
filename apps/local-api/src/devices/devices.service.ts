import {
  deviceInventorySchema,
  deviceRevocationSchema,
  pairingCertificateSchema,
  pairingSessionCancelledSchema,
  pairingSessionConfirmedSchema,
  pairingSessionStartedSchema,
  pairingSessionViewSchema,
  seatReleaseApprovalSchema,
  seatReleaseRequestSchema,
  PAIRING_MAX_JOIN_ATTEMPTS,
  PAIRING_SESSION_LIFETIME_SECONDS,
  type DeviceInventory,
  type DeviceRevocation,
  type DeviceRevocationRequest,
  type DevicesDenialCode,
  type PairingCaCertificate,
  type PairingCertificate,
  type PairingCertificateRequest,
  type PairingChannelState,
  type PairingJoinAccepted,
  type PairingJoinRequest,
  type PairingSessionCancelRequest,
  type PairingSessionCancelled,
  type PairingSessionConfirmRequest,
  type PairingSessionConfirmed,
  type PairingSessionStartRequest,
  type PairingSessionStarted,
  type PairingSessionStateName,
  type PairingSessionView,
  type SeatReleaseApproval,
  type SeatReleaseApprovalRequest,
  type SeatReleaseRequest,
  type SeatReleaseRequestCreate,
} from "@breev/contracts/local-rest";
import { Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";

import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { createUuidV7 } from "../pharmacy-ca/pharmacy-ca-crypto.js";
import {
  PharmacyCaService,
  type PharmacyCaState,
} from "../pharmacy-ca/pharmacy-ca.service.js";
import type { TerminalSocketRegistry } from "../pharmacy-ca/terminal-socket-registry.js";
import { devicesDenial, writeDevicesAudit } from "./devices-audit.js";
import {
  buildFetchTranscript,
  buildFingerprintTranscript,
  buildJoinTranscript,
  deriveFingerprintDigits,
  encodePairingBinding,
  encodePairingInvitation,
  evaluateCancellation,
  evaluateCertificateDelivery,
  evaluateConfirmation,
  evaluateJoinAttempt,
  evaluateSeatAllocation,
  describeSeatUsage,
  type PairingSessionSnapshot,
} from "./pairing-domain.js";
import {
  CertificationRequestRejected,
  readCertificationRequest,
  readSubjectPublicKey,
  verifyTranscriptSignature,
} from "./pairing-csr.js";
import { PAIRING_ENDPOINT, type PairingEndpoint } from "./pairing-endpoint.js";

/**
 * Serializes every decision that consumes or frees a device seat for one
 * installation: pairing confirmation, revocation, and seat release. They read
 * the same licence and the same seat count, so they take the same lock and can
 * never interleave.
 */
const DEVICES_INSTALLATION_LOCK = 165_308_863;
const PAIRING_CAPABILITY = "additional-device-pos" as const;

/**
 * Stands in for the installation identity on the two audit facts that can only
 * happen before one exists: a command refused because there is no pharmacy CA,
 * and a pairing start whose key store would not mint the CA's key.
 *
 * `devices_audit_records.installation_id` is `not null`, so these records need
 * a value. It is a fixed, obviously synthetic all-zero UUIDv7 rather than a
 * generated one, because a fresh identifier per event would read back as a
 * crowd of installations that never existed. Both outcomes name the absence
 * explicitly, so the record stays self-describing. Making the column nullable
 * is the cleaner model and is left as a separate schema change.
 */
const NO_INSTALLATION_ID = "00000000-0000-7000-8000-000000000000" as const;
const SEAT_RELEASE_LIFETIME_SECONDS = 300;
const JOIN_SECRET_BYTES = 32;

interface PairingSessionRow {
  readonly bound_at: Date | null;
  readonly bound_device_name: string | null;
  readonly bound_spki_der: Buffer | null;
  readonly cancelled_reason: string | null;
  readonly consumed_at: Date | null;
  readonly expires_at: Date;
  readonly failure_reason: string | null;
  readonly id: string;
  readonly identity_session_id: string;
  readonly installation_id: string;
  readonly join_attempt_count: number;
  readonly join_secret_hash: Buffer;
  readonly max_join_attempts: number;
  readonly pharmacy_id: string;
  readonly started_by_user_id: string;
  readonly state: PairingSessionStateName;
  readonly terminal_device_id: string | null;
}

interface TerminalDeviceRow {
  readonly cert_not_after: Date;
  readonly display_name: string;
  readonly id: string;
  readonly paired_at: Date;
  readonly revocation_reason: string | null;
  readonly revoked_at: Date | null;
  readonly seat_released_at: Date | null;
}

@Injectable()
export class DevicesService {
  /**
   * The invitation URIs this process minted, held in memory only, for the
   * lifetime of their sessions. The join secret inside them is never written
   * to the database, the logs, or an audit record.
   */
  private readonly invitations = new Map<string, string>();
  private registry: TerminalSocketRegistry | undefined;

  // Every dependency is named explicitly. One parameter is injected by token,
  // and a constructor that mixes a token with inferred types resolves only when
  // the whole list is declared.
  public constructor(
    @Inject(LocalDatabaseService)
    private readonly localDatabase: LocalDatabaseService,
    @Inject(IdentityAccessService)
    private readonly identity: IdentityAccessService,
    @Inject(PharmacyCaService)
    private readonly pharmacyCa: PharmacyCaService,
    @Inject(PAIRING_ENDPOINT)
    private readonly endpoint: PairingEndpoint | undefined,
  ) {}

  /**
   * Hands this service the LAN listener's open connections. It is wired at
   * boot, after the listener exists, so revocation can end a device's
   * connections and the device list can report which terminals are connected.
   */
  public useSocketRegistry(registry: TerminalSocketRegistry): void {
    this.registry = registry;
  }

  // ─── Main-side pairing ceremony ────────────────────────────────────────────

  public async startPairingSession(
    request: Request,
    input: PairingSessionStartRequest,
  ): Promise<PairingSessionStarted> {
    const context = await this.requireMainAdministrator(request);
    const installation = (await this.ensureInstallationState()).installationId;
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockInstallation(client, installation);
      const replay = await this.identity.beginDeviceCommand(
        client,
        context,
        "devices.pairing_session.start",
        input,
        pairingSessionStartedSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const fresh = await this.identity.revalidateDeviceAdministration(
        client,
        context,
      );
      await this.identity.consumeDeviceStepUp(
        client,
        fresh,
        input.stepUpChallengeId,
        { action: "devices.pairing.start", subjectId: fresh.pharmacyId },
      );

      if (!fresh.entitlement.capabilities.includes(PAIRING_CAPABILITY)) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.start",
          code: "pairing-entitlement-missing",
          installation,
          outcome: "entitlement-missing",
          statusCode: 403,
        });
      }
      const endpoint = this.endpoint;
      if (endpoint === undefined) {
        // Without a LAN listener there is no address a terminal could reach,
        // so a session would only ever produce an invitation that cannot be
        // answered. Fail closed rather than issue one.
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.start",
          code: "pairing-session-conflict",
          installation,
          outcome: "lan-listener-disabled",
          statusCode: 409,
        });
      }

      await this.expireStaleSessions(client, installation);
      const active = await client.query<{ id: string }>(
        `select id from pairing_sessions
         where installation_id = $1
           and state in ('open', 'awaiting-confirmation')`,
        [installation],
      );
      if (active.rowCount !== 0) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.start",
          code: "pairing-session-conflict",
          installation,
          outcome: "session-already-open",
          statusCode: 409,
          ...(active.rows[0] === undefined
            ? {}
            : { pairingSessionId: active.rows[0].id }),
        });
      }

      const joinSecret = randomBytes(JOIN_SECRET_BYTES);
      const created = await client.query<{ expires_at: Date; id: string }>(
        `insert into pairing_sessions (
           pharmacy_id, installation_id, started_by_user_id, started_device_id,
           identity_session_id, join_secret_hash, max_join_attempts, expires_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7,
           statement_timestamp() + make_interval(secs => $8)
         ) returning id, expires_at`,
        [
          fresh.pharmacyId,
          installation,
          fresh.actorId,
          fresh.deviceId,
          fresh.sessionId,
          createHash("sha256").update(joinSecret).digest(),
          PAIRING_MAX_JOIN_ATTEMPTS,
          PAIRING_SESSION_LIFETIME_SECONDS,
        ],
      );
      const session = created.rows[0];
      if (session === undefined) {
        throw new Error("The pairing session was not created");
      }
      const caFingerprint = await this.caFingerprint(client);
      const invitation = encodePairingInvitation({
        caFingerprint,
        host: endpoint.host,
        installationId: installation,
        joinSecret: joinSecret.toString("base64url"),
        port: endpoint.port,
        sessionId: session.id,
      });
      // What is written down, and what is answered, deliberately differ. The
      // invitation carries the one-use join secret, and an immutable command
      // result would keep it recoverable from an ordinary database read for as
      // long as the row lives. The recorded result therefore holds only the
      // non-secret identity of the session; a replay of the same idempotency
      // key answers with that, and the Main screen reads the invitation it is
      // missing from the current-session route, which serves it from this
      // process's memory while the session is open.
      const recorded = pairingSessionStartedSchema.parse({
        caFingerprint,
        expiresAt: session.expires_at.toISOString(),
        sessionId: session.id,
      });
      const response = pairingSessionStartedSchema.parse({
        ...recorded,
        qrUri: invitation,
      });
      await writeDevicesAudit(client, {
        action: "devices.pairing.start",
        actorUserId: fresh.actorId,
        details: { expiresAt: session.expires_at.toISOString() },
        identitySessionId: fresh.sessionId,
        installationId: installation,
        ...(fresh.deviceId === undefined
          ? {}
          : { mainDeviceId: fresh.deviceId }),
        outcome: "started",
        pairingSessionId: session.id,
        pharmacyId: fresh.pharmacyId,
      });
      await this.identity.recordDeviceCommandResult(
        client,
        fresh,
        "devices.pairing_session.start",
        input,
        recorded,
      );
      await client.query("commit");
      this.rememberInvitation(session.id, invitation);
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async currentPairingSession(
    request: Request,
  ): Promise<PairingSessionView> {
    const context = await this.requireMainAdministrator(request);
    const state = await this.existingInstallationState();
    if (state === undefined) {
      return { state: "none" as const };
    }
    const installation = state.installationId;
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockInstallation(client, installation);
      await this.expireStaleSessions(client, installation);
      const result = await client.query<PairingSessionRow>(
        `${PAIRING_SESSION_SELECT}
         where installation_id = $1 and pharmacy_id = $2
         order by created_at desc, id desc
         limit 1`,
        [installation, context.pharmacyId],
      );
      const row = result.rows[0];
      const view =
        row === undefined
          ? { state: "none" as const }
          : await this.pairingSessionView(client, row, installation);
      await client.query("commit");
      return pairingSessionViewSchema.parse(view);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The confirmation the whole ceremony turns on.
   *
   * One transaction, in a documented order: the installation lock, a fresh
   * identity and permission, the licence read under that lock, a conditional
   * consume of the session, the seat check, the certificate, the device record,
   * and the audit. Any step that does not hold denies and commits its evidence.
   */
  public async confirmPairingSession(
    request: Request,
    sessionId: string,
    input: PairingSessionConfirmRequest,
  ): Promise<PairingSessionConfirmed> {
    const context = await this.requireMainAdministrator(request);
    const installation = await this.requireInstallationId(
      "devices.pairing_session.confirm",
      context,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockInstallation(client, installation);
      const replay = await this.identity.beginDeviceCommand(
        client,
        context,
        "devices.pairing_session.confirm",
        input,
        pairingSessionConfirmedSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const fresh = await this.identity.revalidateDeviceAdministration(
        client,
        context,
      );

      const session = await this.lockSession(client, sessionId);
      if (session === undefined || session.pharmacy_id !== fresh.pharmacyId) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.confirm",
          code: "pairing-session-missing",
          installation,
          outcome: "session-missing",
          statusCode: 404,
        });
      }
      // Only the user who started the ceremony may finish it: the person who
      // read the digits off the terminal is the person who confirms them.
      if (session.started_by_user_id !== fresh.actorId) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.confirm",
          code: "pairing-session-conflict",
          installation,
          outcome: "different-operator",
          pairingSessionId: session.id,
          statusCode: 403,
        });
      }
      const decision = evaluateConfirmation({
        now: new Date(),
        snapshot: snapshotOf(session),
      });
      if (decision.kind === "deny") {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.confirm",
          code: decision.code,
          installation,
          outcome: decision.code,
          pairingSessionId: session.id,
          statusCode: decision.code === "pairing-session-conflict" ? 409 : 409,
        });
      }

      const licence = fresh.entitlement.licence;
      if (
        licence === null ||
        !fresh.entitlement.capabilities.includes(PAIRING_CAPABILITY)
      ) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.confirm",
          code: "pairing-entitlement-missing",
          installation,
          outcome: "entitlement-missing",
          pairingSessionId: session.id,
          statusCode: 403,
        });
      }

      // The seat is counted under the installation lock, before anything is
      // consumed: a pairing refused for want of a seat must leave the operator
      // the session they started, so releasing a seat and confirming again does
      // not mean rerunning the whole ceremony.
      const allocated = await client.query<{ count: string }>(
        `select count(*)::text as count from terminal_devices
         where pharmacy_id = $1 and seat_released_at is null`,
        [fresh.pharmacyId],
      );
      const seat = evaluateSeatAllocation({
        allocatedTerminalSeats: Number(allocated.rows[0]?.count ?? "0"),
        permittedDeviceCount: licence.permittedDeviceCount,
      });
      if (seat.kind === "deny") {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.confirm",
          code: seat.code,
          details: {
            permitted: seat.usage.permitted,
            used: seat.usage.used,
          },
          installation,
          outcome: "seat-unavailable",
          pairingSessionId: session.id,
          statusCode: 409,
        });
      }

      // The conditional consume is the one-use guarantee: a second confirmation
      // of the same session updates no row and is refused as a replay.
      const consumed = await client.query(
        `update pairing_sessions
         set state = 'confirmed',
             confirmed_at = statement_timestamp(),
             consumed_at = statement_timestamp()
         where id = $1
           and state = 'awaiting-confirmation'
           and consumed_at is null
           and expires_at > statement_timestamp()`,
        [session.id],
      );
      if (consumed.rowCount !== 1) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.confirm",
          code: "pairing-session-replayed",
          installation,
          outcome: "session-replayed",
          pairingSessionId: session.id,
          statusCode: 409,
        });
      }

      const spki = session.bound_spki_der;
      const deviceName = session.bound_device_name;
      if (spki === null || deviceName === null) {
        throw new Error("A confirmable pairing session always has a bound key");
      }
      const deviceId = createUuidV7();
      await this.pharmacyCa.assertDeviceCertifiable(client, deviceId);
      const certificate = await this.pharmacyCa.signDeviceCertificate({
        deviceId,
        devicePublicKeyDer: spki,
        licenceId: licence.licenceId,
        pharmacyId: fresh.pharmacyId,
      });
      await client.query(
        `insert into terminal_devices (
           id, installation_id, pharmacy_id, display_name, licence_id,
           cert_fingerprint, cert_serial, cert_not_before, cert_not_after,
           cert_pem, paired_by, pairing_session_id
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          deviceId,
          installation,
          fresh.pharmacyId,
          deviceName,
          licence.licenceId,
          certificate.fingerprint,
          certificate.serialHex,
          certificate.notBefore,
          certificate.notAfter,
          certificate.certPem,
          fresh.actorId,
          session.id,
        ],
      );
      await client.query(
        "update pairing_sessions set terminal_device_id = $2 where id = $1",
        [session.id, deviceId],
      );

      const response = pairingSessionConfirmedSchema.parse({
        deviceId,
        displayName: deviceName,
      });
      await writeDevicesAudit(client, {
        action: "devices.pairing.confirm",
        actorUserId: fresh.actorId,
        details: {
          certFingerprint: certificate.fingerprint,
          permitted: seat.usage.permitted,
          spkiSha256: createHash("sha256").update(spki).digest("hex"),
          used: seat.usage.used,
        },
        deviceId,
        identitySessionId: fresh.sessionId,
        installationId: installation,
        ...(fresh.deviceId === undefined
          ? {}
          : { mainDeviceId: fresh.deviceId }),
        outcome: "confirmed",
        pairingSessionId: session.id,
        pharmacyId: fresh.pharmacyId,
      });
      await this.identity.recordDeviceCommandResult(
        client,
        fresh,
        "devices.pairing_session.confirm",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async cancelPairingSession(
    request: Request,
    sessionId: string,
    input: PairingSessionCancelRequest,
  ): Promise<PairingSessionCancelled> {
    const context = await this.requireMainAdministrator(request);
    const installation = await this.requireInstallationId(
      "devices.pairing_session.cancel",
      context,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockInstallation(client, installation);
      const replay = await this.identity.beginDeviceCommand(
        client,
        context,
        "devices.pairing_session.cancel",
        input,
        pairingSessionCancelledSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const fresh = await this.identity.revalidateDeviceAdministration(
        client,
        context,
      );
      const session = await this.lockSession(client, sessionId);
      if (session === undefined || session.pharmacy_id !== fresh.pharmacyId) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.cancel",
          code: "pairing-session-missing",
          installation,
          outcome: "session-missing",
          statusCode: 404,
        });
      }
      const decision = evaluateCancellation({
        now: new Date(),
        snapshot: snapshotOf(session),
      });
      if (decision.kind === "deny") {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.pairing.cancel",
          code: decision.code,
          installation,
          outcome: decision.code,
          pairingSessionId: session.id,
          statusCode: 409,
        });
      }
      await client.query(
        `update pairing_sessions
         set state = 'cancelled', cancelled_reason = $2
         where id = $1 and state in ('open', 'awaiting-confirmation')`,
        [session.id, input.reason],
      );
      const response = pairingSessionCancelledSchema.parse({
        status: "cancelled",
      });
      await writeDevicesAudit(client, {
        action: "devices.pairing.cancel",
        actorUserId: fresh.actorId,
        details: { reason: input.reason },
        identitySessionId: fresh.sessionId,
        installationId: installation,
        ...(fresh.deviceId === undefined
          ? {}
          : { mainDeviceId: fresh.deviceId }),
        outcome: "cancelled",
        pairingSessionId: session.id,
        pharmacyId: fresh.pharmacyId,
      });
      await this.identity.recordDeviceCommandResult(
        client,
        fresh,
        "devices.pairing_session.cancel",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── Device inventory, revocation, and seats ───────────────────────────────

  public async inventory(request: Request): Promise<DeviceInventory> {
    const context = await this.requireMainAdministrator(request);
    const result = await this.localDatabase
      .requirePool()
      .query<TerminalDeviceRow>(
        `select id, display_name, paired_at, cert_not_after, revoked_at,
                revocation_reason, seat_released_at
         from terminal_devices
         where pharmacy_id = $1
         order by paired_at, id`,
        [context.pharmacyId],
      );
    const allocated = result.rows.filter(
      (row) => row.seat_released_at === null,
    ).length;
    // The permitted device count is licence data and nothing else. Without a
    // valid licence there is no permitted count to report — not a smaller one —
    // so the seat usage is absent rather than invented, and the Main screen says
    // so instead of showing a limit Breev made up.
    const licence = context.entitlement.licence;
    return deviceInventorySchema.parse({
      devices: result.rows.map((row) => ({
        certNotAfter: row.cert_not_after.toISOString(),
        connected: (this.registry?.openSocketCount(row.id) ?? 0) > 0,
        displayName: row.display_name,
        id: row.id,
        pairedAt: row.paired_at.toISOString(),
        revocationReason: row.revocation_reason,
        revokedAt: row.revoked_at?.toISOString() ?? null,
        seatReleasedAt: row.seat_released_at?.toISOString() ?? null,
      })),
      seatUsage:
        licence === null
          ? null
          : describeSeatUsage({
              allocatedTerminalSeats: allocated,
              permittedDeviceCount: licence.permittedDeviceCount,
            }),
    });
  }

  /**
   * Revocation. The device record is the authority every request consults, so
   * flipping it is what actually blocks the terminal; ending its user sessions
   * and destroying its open connections make that effective immediately rather
   * than at the next handshake. The seat stays consumed — freeing it is a
   * separate, two-user decision.
   */
  public async revokeDevice(
    request: Request,
    deviceId: string,
    input: DeviceRevocationRequest,
  ): Promise<DeviceRevocation> {
    const context = await this.requireMainAdministrator(request);
    const installation = await this.requireInstallationId(
      "devices.revoke",
      context,
    );
    const client = await this.localDatabase.requirePool().connect();
    let revoked: DeviceRevocation | undefined;
    try {
      await client.query("begin");
      await this.lockInstallation(client, installation);
      const replay = await this.identity.beginDeviceCommand(
        client,
        context,
        "devices.device.revoke",
        input,
        deviceRevocationSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const fresh = await this.identity.revalidateDeviceAdministration(
        client,
        context,
      );
      await this.identity.consumeDeviceStepUp(
        client,
        fresh,
        input.stepUpChallengeId,
        { action: "devices.revoke", subjectId: deviceId },
      );
      const result = await client.query<{ revoked_at: Date }>(
        `update terminal_devices
         set revoked_at = statement_timestamp(),
             revocation_reason = $3,
             revoked_by = $4
         where id = $1 and pharmacy_id = $2 and revoked_at is null
         returning revoked_at`,
        [deviceId, fresh.pharmacyId, input.reason, fresh.actorId],
      );
      const revokedAt = result.rows[0]?.revoked_at;
      if (result.rowCount !== 1 || revokedAt === undefined) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.device.revoke",
          code: "device-not-found",
          installation,
          outcome: "device-missing-or-already-revoked",
          statusCode: 404,
        });
      }
      await client.query(
        `update identity_sessions
         set revoked_at = statement_timestamp(),
             revocation_reason = 'administrative'
         where terminal_device_id = $1 and revoked_at is null`,
        [deviceId],
      );
      revoked = deviceRevocationSchema.parse({
        revokedAt: revokedAt.toISOString(),
      });
      await writeDevicesAudit(client, {
        action: "devices.device.revoke",
        actorUserId: fresh.actorId,
        details: { reason: input.reason },
        deviceId,
        identitySessionId: fresh.sessionId,
        installationId: installation,
        ...(fresh.deviceId === undefined
          ? {}
          : { mainDeviceId: fresh.deviceId }),
        outcome: "revoked",
        pharmacyId: fresh.pharmacyId,
      });
      await this.identity.recordDeviceCommandResult(
        client,
        fresh,
        "devices.device.revoke",
        input,
        revoked,
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    // Only after the revocation is durable: a destroyed connection whose
    // revocation then rolled back would be an outage, not a denial. The
    // registry also remembers the device from here on, so a request that was
    // verified a moment before this commit cannot register a socket after it.
    this.registry?.revoke(deviceId);
    return revoked;
  }

  public async requestSeatRelease(
    request: Request,
    input: SeatReleaseRequestCreate,
  ): Promise<SeatReleaseRequest> {
    const context = await this.requireMainAdministrator(request);
    const installation = await this.requireInstallationId(
      "devices.seat_release.request",
      context,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockInstallation(client, installation);
      const replay = await this.identity.beginDeviceCommand(
        client,
        context,
        "devices.seat_release.request",
        input,
        seatReleaseRequestSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const fresh = await this.identity.revalidateDeviceAdministration(
        client,
        context,
      );
      await this.identity.consumeDeviceStepUp(
        client,
        fresh,
        input.stepUpChallengeId,
        {
          action: "devices.seat.release.request",
          subjectId: input.deviceId,
        },
      );
      const device = await client.query<{
        revoked_at: Date | null;
        seat_released_at: Date | null;
      }>(
        `select revoked_at, seat_released_at from terminal_devices
         where id = $1 and pharmacy_id = $2
         for update`,
        [input.deviceId, fresh.pharmacyId],
      );
      const row = device.rows[0];
      if (row === undefined) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.seat_release.request",
          code: "device-not-found",
          installation,
          outcome: "device-missing",
          statusCode: 404,
        });
      }
      if (row.revoked_at === null || row.seat_released_at !== null) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.seat_release.request",
          code: "device-not-revoked",
          deviceId: input.deviceId,
          installation,
          outcome:
            row.revoked_at === null ? "device-live" : "seat-already-released",
          statusCode: 409,
        });
      }
      // A newer request replaces an older pending one so the pharmacy is never
      // stuck behind a request nobody remembers making.
      await client.query(
        `update seat_release_requests
         set status = 'superseded', resolved_at = statement_timestamp()
         where terminal_device_id = $1 and status = 'pending'`,
        [input.deviceId],
      );
      const created = await client.query<{ expires_at: Date; id: string }>(
        `insert into seat_release_requests (
           pharmacy_id, terminal_device_id, requested_by, requested_device_id,
           requested_session_id, expires_at
         ) values (
           $1, $2, $3, $4, $5,
           statement_timestamp() + make_interval(secs => $6)
         ) returning id, expires_at`,
        [
          fresh.pharmacyId,
          input.deviceId,
          fresh.actorId,
          fresh.deviceId,
          fresh.sessionId,
          SEAT_RELEASE_LIFETIME_SECONDS,
        ],
      );
      const seatRequest = created.rows[0];
      if (seatRequest === undefined) {
        throw new Error("The seat release request was not created");
      }
      const response = seatReleaseRequestSchema.parse({
        expiresAt: seatRequest.expires_at.toISOString(),
        requestId: seatRequest.id,
      });
      await writeDevicesAudit(client, {
        action: "devices.seat_release.request",
        actorUserId: fresh.actorId,
        deviceId: input.deviceId,
        identitySessionId: fresh.sessionId,
        installationId: installation,
        ...(fresh.deviceId === undefined
          ? {}
          : { mainDeviceId: fresh.deviceId }),
        outcome: "requested",
        pharmacyId: fresh.pharmacyId,
        seatReleaseRequestId: seatRequest.id,
      });
      await this.identity.recordDeviceCommandResult(
        client,
        fresh,
        "devices.seat_release.request",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The second half of the two-user seat release. The approver authenticates
   * here, must hold `devices.pair`, and must not be the requester. There is no
   * emergency bypass, and two local users can complete it entirely offline.
   */
  public async approveSeatRelease(
    request: Request,
    requestId: string,
    input: SeatReleaseApprovalRequest,
  ): Promise<SeatReleaseApproval> {
    const context = await this.requireMainAdministrator(request);
    const installation = await this.requireInstallationId(
      "devices.seat_release.approve",
      context,
    );
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockInstallation(client, installation);
      const replay = await this.identity.beginDeviceCommand(
        client,
        context,
        "devices.seat_release.approve",
        input,
        seatReleaseApprovalSchema,
      );
      if (replay !== undefined) {
        await client.query("commit");
        return replay;
      }
      const fresh = await this.identity.revalidateDeviceAdministration(
        client,
        context,
      );
      const pending = await client.query<{
        expires_at: Date;
        requested_by: string;
        status: string;
        terminal_device_id: string;
      }>(
        `select expires_at, requested_by, status, terminal_device_id
         from seat_release_requests
         where id = $1 and pharmacy_id = $2
         for update`,
        [requestId, fresh.pharmacyId],
      );
      const seatRequest = pending.rows[0];
      if (seatRequest === undefined) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.seat_release.approve",
          code: "seat-release-request-invalid",
          installation,
          outcome: "request-missing",
          statusCode: 404,
        });
      }
      if (
        seatRequest.status !== "pending" ||
        seatRequest.expires_at.getTime() <= Date.now()
      ) {
        if (seatRequest.status === "pending") {
          await client.query(
            `update seat_release_requests
             set status = 'expired', resolved_at = statement_timestamp()
             where id = $1 and status = 'pending'`,
            [requestId],
          );
        }
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.seat_release.approve",
          code: "seat-release-request-invalid",
          deviceId: seatRequest.terminal_device_id,
          installation,
          outcome:
            seatRequest.status === "pending"
              ? "request-expired"
              : "request-resolved",
          seatReleaseRequestId: requestId,
          statusCode: 409,
        });
      }

      const approver = await this.identity.authenticateApprover(client, fresh, {
        password: input.approverPassword,
        permission: "devices.pair",
        username: input.approverUsername,
      });
      if (
        approver === undefined ||
        approver.actorId === seatRequest.requested_by
      ) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.seat_release.approve",
          code: "seat-release-approver-invalid",
          deviceId: seatRequest.terminal_device_id,
          installation,
          outcome:
            approver === undefined
              ? "approver-invalid"
              : "approver-is-requester",
          seatReleaseRequestId: requestId,
          statusCode: 403,
        });
      }

      await client.query(
        `update seat_release_requests
         set status = 'approved',
             approved_by = $2,
             resolved_at = statement_timestamp()
         where id = $1 and status = 'pending'`,
        [requestId, approver.actorId],
      );
      const released = await client.query<{ seat_released_at: Date }>(
        `update terminal_devices
         set seat_released_at = statement_timestamp(),
             seat_released_by = $2,
             seat_release_request_id = $3
         where id = $1 and revoked_at is not null and seat_released_at is null
         returning seat_released_at`,
        [seatRequest.terminal_device_id, approver.actorId, requestId],
      );
      const releasedAt = released.rows[0]?.seat_released_at;
      if (released.rowCount !== 1 || releasedAt === undefined) {
        throw await this.denyInTransaction(client, fresh, {
          action: "devices.seat_release.approve",
          code: "device-not-revoked",
          deviceId: seatRequest.terminal_device_id,
          installation,
          outcome: "seat-not-releasable",
          seatReleaseRequestId: requestId,
          statusCode: 409,
        });
      }
      const response = seatReleaseApprovalSchema.parse({
        releasedAt: releasedAt.toISOString(),
      });
      await writeDevicesAudit(client, {
        action: "devices.seat_release.approve",
        actorUserId: approver.actorId,
        deviceId: seatRequest.terminal_device_id,
        identitySessionId: fresh.sessionId,
        installationId: installation,
        ...(fresh.deviceId === undefined
          ? {}
          : { mainDeviceId: fresh.deviceId }),
        outcome: "released",
        pharmacyId: fresh.pharmacyId,
        seatReleaseRequestId: requestId,
      });
      await this.identity.recordDeviceCommandResult(
        client,
        fresh,
        "devices.seat_release.approve",
        input,
        response,
      );
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── LAN pairing channel ───────────────────────────────────────────────────

  public async caCertificate(): Promise<PairingCaCertificate> {
    const state = await this.existingInstallationState();
    if (state === undefined) {
      throw new Error("CA not initialized");
    }
    return {
      caCertificatePem: state.caCertPem,
      installationId: state.installationId,
    };
  }

  /**
   * The terminal's one attempt to claim a session.
   *
   * Everything happens under a row lock so two terminals racing the same QR are
   * ordered rather than both binding. A wrong secret is counted, audited, and
   * committed even though the request is refused, and the response never says
   * whether the session existed.
   */
  public async join(input: PairingJoinRequest): Promise<PairingJoinAccepted> {
    await this.requireInstallationId("devices.pairing.join");
    const state = this.requireExistingInstallationState();
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      const session = await this.lockSession(client, input.sessionId);
      if (session === undefined) {
        const requestId = await writeDevicesAudit(client, {
          action: "devices.pairing.join",
          installationId: state.installationId,
          outcome: "session-missing",
        });
        await client.query("commit");
        throw devicesDenial(404, "pairing-session-missing", requestId);
      }
      const presented = decodeJoinSecret(input.joinSecret);
      const decision = evaluateJoinAttempt({
        now: new Date(),
        secretMatches:
          presented !== undefined &&
          constantTimeEquals(
            createHash("sha256").update(presented).digest(),
            session.join_secret_hash,
          ),
        snapshot: snapshotOf(session),
      });
      if (decision.kind === "deny") {
        throw await this.commitJoinDenial(
          client,
          session,
          state.installationId,
          {
            attemptDelta: decision.recordAttempt ? 1 : 0,
            auditOutcome: decision.auditCode,
            nextState: decision.nextState,
            responseCode: decision.responseCode,
          },
        );
      }

      let accepted;
      try {
        accepted = readCertificationRequest(input.csrPem);
      } catch (error) {
        if (!(error instanceof CertificationRequestRejected)) {
          throw error;
        }
        throw await this.commitJoinDenial(
          client,
          session,
          state.installationId,
          {
            attemptDelta: 1,
            auditOutcome: `csr-${error.reason}`,
            nextState: undefined,
            responseCode: "pairing-signature-invalid",
          },
        );
      }
      const transcript = buildJoinTranscript({
        caFingerprint: await this.caFingerprint(client),
        installationId: state.installationId,
        sessionId: session.id,
        spkiDer: accepted.spkiDer,
      });
      if (
        !verifyTranscriptSignature({
          publicKey: accepted.publicKey,
          signature: Buffer.from(input.transcriptSignature, "base64"),
          transcript,
        })
      ) {
        throw await this.commitJoinDenial(
          client,
          session,
          state.installationId,
          {
            attemptDelta: 1,
            auditOutcome: "proof-of-possession-invalid",
            nextState: undefined,
            responseCode: "pairing-signature-invalid",
          },
        );
      }

      const bound = await client.query(
        `update pairing_sessions
         set state = 'awaiting-confirmation',
             bound_spki_der = $2,
             bound_device_name = $3,
             bound_at = statement_timestamp()
         where id = $1 and state = 'open' and bound_at is null
           and expires_at > statement_timestamp()`,
        [session.id, accepted.spkiDer, input.deviceName],
      );
      if (bound.rowCount !== 1) {
        throw await this.commitJoinDenial(
          client,
          session,
          state.installationId,
          {
            attemptDelta: 0,
            auditOutcome: "pairing-session-replayed",
            nextState: undefined,
            responseCode: "pairing-session-replayed",
          },
        );
      }
      await writeDevicesAudit(client, {
        action: "devices.pairing.join",
        details: { spkiSha256: accepted.spkiSha256 },
        installationId: state.installationId,
        outcome: "bound",
        pairingSessionId: session.id,
        pharmacyId: session.pharmacy_id,
      });
      await client.query("commit");
      return { status: "bound" };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async channelState(sessionId: string): Promise<PairingChannelState> {
    await this.requireInstallationId("devices.pairing.state");
    const state = this.requireExistingInstallationState();
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      await this.lockInstallation(client, state.installationId);
      await this.expireStaleSessions(client, state.installationId);
      const result = await client.query<{ state: PairingSessionStateName }>(
        "select state from pairing_sessions where id = $1",
        [sessionId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        const requestId = await writeDevicesAudit(client, {
          action: "devices.pairing.state",
          installationId: state.installationId,
          outcome: "session-missing",
        });
        await client.query("commit");
        throw devicesDenial(404, "pairing-session-missing", requestId);
      }
      await client.query("commit");
      return { state: row.state };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delivery of the issued certificate. It carries only public material and is
   * idempotent, because a terminal that lost the response has to be able to ask
   * again — but only the holder of the bound private key can ask at all.
   */
  public async certificate(
    input: PairingCertificateRequest,
  ): Promise<PairingCertificate> {
    await this.requireInstallationId("devices.pairing.certificate");
    const state = this.requireExistingInstallationState();
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("begin");
      const session = await this.lockSession(client, input.sessionId);
      if (session === undefined) {
        const requestId = await writeDevicesAudit(client, {
          action: "devices.pairing.certificate",
          installationId: state.installationId,
          outcome: "session-missing",
        });
        await client.query("commit");
        throw devicesDenial(404, "pairing-session-missing", requestId);
      }
      const decision = evaluateCertificateDelivery({
        now: new Date(),
        snapshot: snapshotOf(session),
      });
      if (decision.kind === "deny") {
        const requestId = await writeDevicesAudit(client, {
          action: "devices.pairing.certificate",
          installationId: state.installationId,
          outcome: decision.code,
          pairingSessionId: session.id,
          pharmacyId: session.pharmacy_id,
        });
        await client.query("commit");
        throw devicesDenial(409, decision.code, requestId);
      }
      const spki = session.bound_spki_der;
      const deviceId = session.terminal_device_id;
      if (spki === null || deviceId === null) {
        throw new Error("A confirmed pairing session always names its device");
      }
      if (
        !verifyTranscriptSignature({
          publicKey: readSubjectPublicKey(spki),
          signature: Buffer.from(input.signature, "base64"),
          transcript: buildFetchTranscript({
            installationId: state.installationId,
            sessionId: session.id,
            spkiDer: spki,
          }),
        })
      ) {
        const requestId = await writeDevicesAudit(client, {
          action: "devices.pairing.certificate",
          installationId: state.installationId,
          outcome: "proof-of-possession-invalid",
          pairingSessionId: session.id,
          pharmacyId: session.pharmacy_id,
        });
        await client.query("commit");
        throw devicesDenial(403, "pairing-signature-invalid", requestId);
      }
      const device = await client.query<{ cert_pem: string }>(
        "select cert_pem from terminal_devices where id = $1",
        [deviceId],
      );
      const certPem = device.rows[0]?.cert_pem;
      if (certPem === undefined) {
        throw new Error("A confirmed pairing session always has a certificate");
      }
      await writeDevicesAudit(client, {
        action: "devices.pairing.certificate",
        deviceId,
        installationId: state.installationId,
        outcome: "delivered",
        pairingSessionId: session.id,
        pharmacyId: session.pharmacy_id,
      });
      await client.query("commit");
      return pairingCertificateSchema.parse({
        caCertificatePem: state.caCertPem,
        certificatePem: certPem,
        deviceId,
        installationId: state.installationId,
      });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Device administration is a Main Pharmacy Computer decision. A terminal
   * holding `devices.pair` still cannot pair, revoke, or release a seat: the
   * physical confirmation these actions depend on happens at the Main.
   */
  private async requireMainAdministrator(
    request: Request,
  ): Promise<IdentityExecutionContext> {
    const context = await this.identity.requirePermission(
      request,
      "devices.pair",
    );
    if (context.deviceId === undefined) {
      let installation = (await this.existingInstallationState())
        ?.installationId;
      if (installation === undefined) {
        const pool = this.localDatabase.requirePool();
        const idResult = await pool.query<{ id: string }>(
          "select uuidv7()::text as id",
        );
        installation =
          idResult.rows[0]?.id ?? "00000000-0000-7000-8000-000000000000";
      }
      const requestId = await writeDevicesAudit(
        this.localDatabase.requirePool(),
        {
          action: "devices.administration",
          actorUserId: context.actorId,
          ...(context.terminalDeviceId === undefined
            ? {}
            : { deviceId: context.terminalDeviceId }),
          identitySessionId: context.sessionId,
          installationId: installation,
          outcome: "terminal-not-permitted",
          pharmacyId: context.pharmacyId,
        },
      );
      throw devicesDenial(403, "device-not-found", requestId);
    }
    return context;
  }

  /**
   * Keeps at most one invitation — the ceremony is one-at-a-time — so a long
   * running Main never accumulates secrets in memory.
   */
  private rememberInvitation(sessionId: string, qrUri: string): void {
    this.invitations.clear();
    this.invitations.set(sessionId, qrUri);
  }

  /**
   * The installation identity, or nothing.
   *
   * Every read path uses this. It never creates a pharmacy CA: minting one
   * generates a machine key and is an installation-lifecycle act, not something
   * a status poll may trigger.
   */
  private existingInstallationState(): PharmacyCaState | undefined {
    try {
      return this.pharmacyCa.requireState();
    } catch {
      return undefined;
    }
  }

  /**
   * The installation identity for a caller that has already refused the request
   * when there is none — every use sits immediately after
   * {@link requireInstallationId}, which throws its denial first. Reaching this
   * without a CA is therefore a programming fault, not a decision, so it throws
   * rather than inventing a state or asserting one into existence.
   */
  private requireExistingInstallationState(): PharmacyCaState {
    const state = this.existingInstallationState();
    if (state === undefined) {
      throw new Error("The pharmacy CA state was required but is absent");
    }
    return state;
  }

  /**
   * The installation identity, created if this is the first time it is needed.
   *
   * Only the pairing-start command calls this, and only after it has proved the
   * `devices.pair` permission, a Step-Up, and the `additional-device-pos`
   * entitlement — the licence that is the sole reason a terminal, and therefore
   * a device certificate, would exist at all. The boot path in
   * `createLanMtlsServer` is the other creator; there is deliberately no third.
   */
  private async ensureInstallationState(): Promise<PharmacyCaState> {
    const existing = this.existingInstallationState();
    if (existing !== undefined) {
      return existing;
    }
    try {
      await this.pharmacyCa.initializeCA();
    } catch {
      // A key store that will not mint a key is an infrastructure failure, but
      // it is still a decision this command has to report rather than a crash:
      // it answers with its own code, records the outcome, and leaves the API
      // serving every other request.
      const requestId = await writeDevicesAudit(
        this.localDatabase.requirePool(),
        {
          action: "devices.pairing_session.start",
          installationId: NO_INSTALLATION_ID,
          outcome: "ca-key-store-failure",
        },
      );
      throw devicesDenial(500, "ca-key-store-failure", requestId);
    }
    return this.pharmacyCa.requireState();
  }

  /**
   * The installation identity for a command that presupposes one. A pairing
   * confirmation, a revocation, or a seat release only means anything once
   * pairing has started, so their absence of a CA is a refusal rather than a
   * reason to create one.
   */
  private async requireInstallationId(
    action: string,
    context?: IdentityExecutionContext,
  ): Promise<string> {
    const state = this.existingInstallationState();
    if (state !== undefined) {
      return state.installationId;
    }
    const requestId = await writeDevicesAudit(
      this.localDatabase.requirePool(),
      {
        action,
        installationId: NO_INSTALLATION_ID,
        outcome: "ca-not-found",
        ...(context?.actorId === undefined
          ? {}
          : { actorUserId: context.actorId }),
        ...(context?.terminalDeviceId === undefined
          ? {}
          : { deviceId: context.terminalDeviceId }),
        ...(context?.sessionId === undefined
          ? {}
          : { identitySessionId: context.sessionId }),
        ...(context?.pharmacyId === undefined
          ? {}
          : { pharmacyId: context.pharmacyId }),
      },
    );
    throw devicesDenial(409, "ca-not-found", requestId);
  }

  private async caFingerprint(client: PoolClient): Promise<string> {
    const result = await client.query<{ ca_fingerprint: string }>(
      "select ca_fingerprint from pharmacy_ca where singleton = true",
    );
    const fingerprint = result.rows[0]?.ca_fingerprint;
    if (fingerprint === undefined) {
      throw new Error("The pharmacy CA fingerprint is missing");
    }
    return fingerprint;
  }

  private async lockInstallation(
    client: PoolClient,
    installationId: string,
  ): Promise<void> {
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1::text, $2))`,
      [installationId, DEVICES_INSTALLATION_LOCK],
    );
  }

  private async lockSession(
    client: PoolClient,
    sessionId: string,
  ): Promise<PairingSessionRow | undefined> {
    const result = await client.query<PairingSessionRow>(
      `${PAIRING_SESSION_SELECT} where id = $1 for update`,
      [sessionId],
    );
    return result.rows[0];
  }

  /**
   * Server-side expiry. The five-minute window is enforced by the server clock
   * on every transition, and a lapsed session is written down as expired rather
   * than left looking open.
   */
  private async expireStaleSessions(
    client: PoolClient,
    installationId: string,
  ): Promise<void> {
    await client.query(
      `update pairing_sessions
       set state = 'expired'
       where installation_id = $1
         and state in ('open', 'awaiting-confirmation')
         and expires_at <= statement_timestamp()`,
      [installationId],
    );
  }

  private async pairingSessionView(
    client: PoolClient,
    row: PairingSessionRow,
    installationId: string,
  ): Promise<PairingSessionView> {
    if (row.state === "open") {
      const invitation = this.invitations.get(row.id);
      if (invitation === undefined) {
        // The join secret is held only in this process, for the five minutes
        // the session lasts, and is never written down. A Main API that
        // restarted mid-ceremony can no longer show the invitation it minted,
        // so the session is closed rather than shown as usable.
        await client.query(
          `update pairing_sessions set state = 'expired'
           where id = $1 and state = 'open'`,
          [row.id],
        );
        return { state: "expired", sessionId: row.id };
      }
      return {
        state: "open",
        caFingerprint: await this.caFingerprint(client),
        expiresAt: row.expires_at.toISOString(),
        qrUri: invitation,
        sessionId: row.id,
      };
    }
    if (row.state === "awaiting-confirmation") {
      const endpoint = this.endpoint;
      const spki = row.bound_spki_der;
      const deviceName = row.bound_device_name;
      if (endpoint === undefined || spki === null || deviceName === null) {
        return { state: "none" };
      }
      const caFingerprint = await this.caFingerprint(client);
      return {
        state: "awaiting-confirmation",
        expiresAt: row.expires_at.toISOString(),
        fingerprintDigits: deriveFingerprintDigits(
          buildFingerprintTranscript({
            caFingerprint,
            installationId,
            sessionId: row.id,
            spkiDer: spki,
          }),
        ),
        qrV2Uri: encodePairingBinding({
          caFingerprint,
          host: endpoint.host,
          installationId,
          port: endpoint.port,
          sessionId: row.id,
          spkiSha256: createHash("sha256").update(spki).digest("hex"),
        }),
        sessionId: row.id,
        terminalName: deviceName,
      };
    }
    if (row.state === "confirmed") {
      const device = await client.query<{ display_name: string; id: string }>(
        "select id, display_name from terminal_devices where pairing_session_id = $1",
        [row.id],
      );
      const device_row = device.rows[0];
      if (device_row === undefined) {
        return { state: "none" };
      }
      return {
        state: "confirmed",
        deviceId: device_row.id,
        displayName: device_row.display_name,
        sessionId: row.id,
      };
    }
    if (row.state === "cancelled") {
      return {
        state: "cancelled",
        reason:
          row.cancelled_reason === "fingerprint-mismatch"
            ? "fingerprint-mismatch"
            : "user-cancelled",
        sessionId: row.id,
      };
    }
    if (row.state === "failed") {
      return { state: "failed", reason: "excess-attempts", sessionId: row.id };
    }
    return { state: "expired", sessionId: row.id };
  }

  /**
   * The denial-then-commit idiom: the refusal is written down, the transaction
   * commits so the evidence survives, and only then does the caller learn it
   * was refused.
   */
  private async denyInTransaction(
    client: PoolClient,
    context: IdentityExecutionContext,
    input: {
      readonly action: string;
      readonly code: DevicesDenialCode;
      readonly details?: Readonly<Record<string, boolean | number | string>>;
      readonly deviceId?: string;
      readonly installation: string;
      readonly outcome: string;
      readonly pairingSessionId?: string;
      readonly seatReleaseRequestId?: string;
      readonly statusCode: number;
    },
  ): Promise<never> {
    const requestId = await writeDevicesAudit(client, {
      action: input.action,
      actorUserId: context.actorId,
      ...(input.details === undefined ? {} : { details: input.details }),
      ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      identitySessionId: context.sessionId,
      installationId: input.installation,
      ...(context.deviceId === undefined
        ? {}
        : { mainDeviceId: context.deviceId }),
      outcome: input.outcome,
      ...(input.pairingSessionId === undefined
        ? {}
        : { pairingSessionId: input.pairingSessionId }),
      pharmacyId: context.pharmacyId,
      ...(input.seatReleaseRequestId === undefined
        ? {}
        : { seatReleaseRequestId: input.seatReleaseRequestId }),
    });
    await client.query("commit");
    return Promise.reject(
      devicesDenial(input.statusCode, input.code, requestId),
    );
  }

  /**
   * The one place a refused join is written down.
   *
   * The attempt budget is spent by whatever consumed it — a wrong secret, a
   * malformed certificate request, or a proof of possession that does not match
   * — so the session dies on the attempt that spends the last one, whichever
   * validation refused it. Otherwise a terminal could burn the whole budget on
   * malformed requests while the Main went on showing a QR that nothing could
   * still use. The audit says the budget ran out and keeps the true reason
   * beside it.
   */
  private async commitJoinDenial(
    client: PoolClient,
    session: PairingSessionRow,
    installationId: string,
    input: {
      readonly attemptDelta: number;
      readonly auditOutcome: string;
      readonly nextState: PairingSessionStateName | undefined;
      readonly responseCode: DevicesDenialCode;
    },
  ): Promise<never> {
    const attempts = Math.min(
      session.join_attempt_count + input.attemptDelta,
      session.max_join_attempts,
    );
    const nextState =
      input.nextState ??
      (attempts >= session.max_join_attempts && session.state === "open"
        ? "failed"
        : undefined);
    if (input.attemptDelta > 0 || nextState !== undefined) {
      await client.query(
        `update pairing_sessions
         set join_attempt_count = $2,
             state = $3::pairing_session_state,
             failure_reason = case
               when $3::pairing_session_state = 'failed'
               then 'excess-attempts'
             end
         where id = $1`,
        [session.id, attempts, nextState ?? session.state],
      );
    }
    const exhausted =
      nextState === "failed" &&
      input.auditOutcome !== "pairing-attempts-exceeded";
    const requestId = await writeDevicesAudit(client, {
      action: "devices.pairing.join",
      details: exhausted
        ? { attempts, reason: input.auditOutcome }
        : { attempts },
      installationId,
      outcome: exhausted ? "pairing-attempts-exceeded" : input.auditOutcome,
      pairingSessionId: session.id,
      pharmacyId: session.pharmacy_id,
    });
    await client.query("commit");
    return Promise.reject(
      devicesDenial(
        input.responseCode === "pairing-session-missing" ? 404 : 409,
        input.responseCode,
        requestId,
      ),
    );
  }
}

const PAIRING_SESSION_SELECT = `select id, pharmacy_id, installation_id,
       started_by_user_id, identity_session_id, state, join_secret_hash,
       join_attempt_count, max_join_attempts, bound_spki_der,
       bound_device_name, bound_at, consumed_at, cancelled_reason,
       failure_reason, terminal_device_id, expires_at
from pairing_sessions`;

function snapshotOf(row: PairingSessionRow): PairingSessionSnapshot {
  return {
    boundAt: row.bound_at ?? undefined,
    consumedAt: row.consumed_at ?? undefined,
    expiresAt: row.expires_at,
    joinAttemptCount: row.join_attempt_count,
    maxJoinAttempts: row.max_join_attempts,
    state: row.state,
  };
}

function decodeJoinSecret(value: string): Buffer | undefined {
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === JOIN_SECRET_BYTES ? decoded : undefined;
}

function constantTimeEquals(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
