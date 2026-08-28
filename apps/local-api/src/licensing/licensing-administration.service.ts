import type {
  EntitlementContext,
  LicenceDeactivateRequest,
  LicenceInstallRequest,
} from "@breev/contracts/local-rest";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";

import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import {
  LicensingCommandConflict,
  LicensingService,
  type LicensingCommandName,
  type LicensingContextInput,
} from "./licensing.service.js";

@Injectable()
export class LicensingAdministrationService {
  public constructor(
    private readonly identity: IdentityAccessService,
    private readonly licensing: LicensingService,
    private readonly localDatabase: LocalDatabaseService,
  ) {}

  public async install(
    request: Request,
    input: LicenceInstallRequest,
  ): Promise<EntitlementContext> {
    const context = await this.identity.requirePermission(
      request,
      "licensing.manage",
    );
    const replayCheckedAt = new Date();
    const fingerprint = this.licensing.fingerprint(
      "licence.install",
      input.encodedLicence,
    );
    const replay = await this.replayOrReject(
      this.localDatabase.requirePool(),
      context,
      "licence.install",
      input.idempotencyKey,
      fingerprint,
      replayCheckedAt,
    );
    if (replay !== undefined) return replay;

    const now = new Date();
    const prepared = await this.licensing.prepareInstallation({
      actorId: context.actorId,
      encodedLicence: input.encodedLicence,
      identitySessionId: context.sessionId,
      mainDeviceId: context.deviceId,
      now,
      pharmacyId: context.pharmacyId,
    });
    return await this.execute(
      context,
      input.challengeId,
      "licensing.licence.install",
      "licence.install",
      input.idempotencyKey,
      fingerprint,
      now,
      async (client, fresh) => {
        await this.licensing.installPrepared(
          client,
          {
            actorId: fresh.actorId,
            encodedLicence: input.encodedLicence,
            identitySessionId: fresh.sessionId,
            mainDeviceId: fresh.deviceId,
            now,
            pharmacyId: fresh.pharmacyId,
          },
          prepared,
        );
        return prepared.entitlement;
      },
    );
  }

  public async deactivate(
    request: Request,
    input: LicenceDeactivateRequest,
  ): Promise<EntitlementContext> {
    const context = await this.identity.requirePermission(
      request,
      "licensing.manage",
    );
    const replayCheckedAt = new Date();
    const fingerprint = this.licensing.fingerprint("licence.deactivate");
    const replay = await this.replayOrReject(
      this.localDatabase.requirePool(),
      context,
      "licence.deactivate",
      input.idempotencyKey,
      fingerprint,
      replayCheckedAt,
    );
    if (replay !== undefined) return replay;

    const now = new Date();
    return await this.execute(
      context,
      input.challengeId,
      "licensing.licence.deactivate",
      "licence.deactivate",
      input.idempotencyKey,
      fingerprint,
      now,
      async (client, fresh) =>
        await this.licensing.deactivate(client, actorInput(fresh, now)),
    );
  }

  private async execute(
    context: IdentityExecutionContext,
    challengeId: string,
    stepUpAction: "licensing.licence.deactivate" | "licensing.licence.install",
    command: LicensingCommandName,
    idempotencyKey: string,
    fingerprint: Buffer,
    now: Date,
    perform: (
      client: PoolClient,
      fresh: IdentityExecutionContext,
    ) => Promise<EntitlementContext>,
  ): Promise<EntitlementContext> {
    const client = await this.localDatabase.requirePool().connect();
    let transactionOpen = false;
    try {
      await client.query("begin");
      transactionOpen = true;
      const fresh = await this.identity.revalidateLicenceAdministration(
        client,
        context,
      );
      let replay: EntitlementContext | undefined;
      try {
        replay = await this.licensing.replayCommand(client, {
          command,
          fingerprint,
          idempotencyKey,
          pharmacyId: fresh.pharmacyId,
        });
      } catch (error) {
        if (!(error instanceof LicensingCommandConflict)) throw error;
        const denial = await this.licensing.idempotencyConflict(client, {
          ...actorInput(fresh, now),
          command,
        });
        await client.query("commit");
        transactionOpen = false;
        throw denial;
      }
      if (replay !== undefined) {
        const current = await this.licensing.current(
          actorInput(fresh, new Date()),
          client,
        );
        await client.query("commit");
        transactionOpen = false;
        return current;
      }
      await this.identity.consumeLicenceAdministrationStepUp(
        client,
        fresh,
        challengeId,
        stepUpAction,
      );
      const response = await perform(client, fresh);
      await this.licensing.recordCommandResult(client, {
        ...actorInput(fresh, now),
        command,
        fingerprint,
        idempotencyKey,
        response,
      });
      await client.query("commit");
      transactionOpen = false;
      return response;
    } catch (error) {
      if (transactionOpen)
        await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async replayOrReject(
    queryable: Pool | PoolClient,
    context: IdentityExecutionContext,
    command: LicensingCommandName,
    idempotencyKey: string,
    fingerprint: Buffer,
    now: Date,
  ): Promise<EntitlementContext | undefined> {
    try {
      const replay = await this.licensing.replayCommand(queryable, {
        command,
        fingerprint,
        idempotencyKey,
        pharmacyId: context.pharmacyId,
      });
      return replay === undefined
        ? undefined
        : await this.licensing.current(
            actorInput(context, new Date()),
            queryable,
          );
    } catch (error) {
      if (error instanceof LicensingCommandConflict) {
        throw await this.licensing.idempotencyConflict(queryable, {
          ...actorInput(context, now),
          command,
        });
      }
      throw error;
    }
  }
}

function actorInput(
  context: IdentityExecutionContext,
  now: Date,
): LicensingContextInput & { readonly actorId: string } {
  return {
    actorId: context.actorId,
    identitySessionId: context.sessionId,
    mainDeviceId: context.deviceId,
    now,
    pharmacyId: context.pharmacyId,
  };
}
