import {
  capabilityProofContract,
  capabilityProofRequestSchema,
  capabilityProofSuccessSchema,
  entitlementContextSchema,
  licenceDeactivateContract,
  licenceDeactivateRequestSchema,
  licenceInstallContract,
  licenceInstallRequestSchema,
  type CapabilityProofSuccess,
  type EntitlementContext,
} from "@breev/contracts/local-rest";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { IdentityAccessService } from "../identity-access/identity-access.service.js";
import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import { LicensingAdministrationService } from "./licensing-administration.service.js";
import { LicensingService } from "./licensing.service.js";

@Controller()
export class LicensingController {
  public constructor(
    private readonly identity: IdentityAccessService,
    private readonly administration: LicensingAdministrationService,
    private readonly licensing: LicensingService,
  ) {}

  @Post(licenceInstallContract.path)
  @HttpCode(201)
  public async install(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<EntitlementContext> {
    return await translateIdentityDenial(async () => {
      const input = licenceInstallRequestSchema.safeParse(body);
      if (!input.success) return await this.identity.rejectInvalidBody(request);
      return entitlementContextSchema.parse(
        await this.administration.install(request, input.data),
      );
    });
  }

  @Post(licenceDeactivateContract.path)
  @HttpCode(201)
  public async deactivate(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<EntitlementContext> {
    return await translateIdentityDenial(async () => {
      const input = licenceDeactivateRequestSchema.safeParse(body);
      if (!input.success) return await this.identity.rejectInvalidBody(request);
      return entitlementContextSchema.parse(
        await this.administration.deactivate(request, input.data),
      );
    });
  }

  @Post(capabilityProofContract.path)
  @HttpCode(200)
  public async capabilityProof(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CapabilityProofSuccess> {
    return await translateIdentityDenial(async () => {
      const input = capabilityProofRequestSchema.safeParse(body);
      if (!input.success) return await this.identity.rejectInvalidBody(request);
      const context = await this.identity.requirePermission(
        request,
        "pharmacy.settings.manage",
      );
      await this.licensing.requireCapability({
        actorId: context.actorId,
        capability: input.data.capability,
        identitySessionId: context.sessionId,
        mainDeviceId: context.licensingDeviceId,
        now: new Date(),
        pharmacyId: context.pharmacyId,
      });
      return capabilityProofSuccessSchema.parse({
        status: "allowed",
        capability: input.data.capability,
      });
    });
  }
}
