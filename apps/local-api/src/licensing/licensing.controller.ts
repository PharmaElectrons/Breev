import {
  capabilityProofContract,
  capabilityProofRequestSchema,
  capabilityProofSuccessSchema,
  entitlementContextSchema,
  licenceInstallContract,
  licenceInstallRequestSchema,
  type CapabilityProofSuccess,
  type EntitlementContext,
} from "@breev/contracts/local-rest";
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { IdentityAccessService } from "../identity-access/identity-access.service.js";
import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import { LicensingDenied, LicensingService } from "./licensing.service.js";

@Controller()
export class LicensingController {
  public constructor(
    private readonly identity: IdentityAccessService,
    private readonly licensing: LicensingService,
  ) {}

  @Post(licenceInstallContract.path)
  @HttpCode(201)
  public async install(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<EntitlementContext> {
    return await translateLicensingDenial(() =>
      translateIdentityDenial(async () => {
        const input = licenceInstallRequestSchema.safeParse(body);
        if (!input.success)
          return await this.identity.rejectInvalidBody(request);
        const context = await this.identity.authorizeLicenceInstallation(
          request,
          input.data.challengeId,
        );
        return entitlementContextSchema.parse(
          await this.licensing.install({
            actorId: context.actorId,
            encodedLicence: input.data.encodedLicence,
            identitySessionId: context.sessionId,
            mainDeviceId: context.deviceId,
            now: new Date(),
            pharmacyId: context.pharmacyId,
          }),
        );
      }),
    );
  }

  @Post(capabilityProofContract.path)
  @HttpCode(200)
  public async capabilityProof(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CapabilityProofSuccess> {
    return await translateLicensingDenial(() =>
      translateIdentityDenial(async () => {
        const input = capabilityProofRequestSchema.safeParse(body);
        if (!input.success)
          return await this.identity.rejectInvalidBody(request);
        const context = await this.identity.requirePermission(
          request,
          "pharmacy.settings.manage",
        );
        await this.licensing.requireCapability({
          actorId: context.actorId,
          capability: input.data.capability,
          identitySessionId: context.sessionId,
          mainDeviceId: context.deviceId,
          now: new Date(),
          pharmacyId: context.pharmacyId,
        });
        return capabilityProofSuccessSchema.parse({
          status: "allowed",
          capability: input.data.capability,
        });
      }),
    );
  }
}

async function translateLicensingDenial<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LicensingDenied) {
      throw new HttpException(error.denial, 403);
    }
    throw error;
  }
}
