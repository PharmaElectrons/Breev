import {
  LOCAL_PROOF_MUTATION_SUCCESS_STATUS,
  localProofEvidenceContract,
  localProofMutationContract,
  localProofMutationRequestSchema,
  type LocalProofEvidenceSuccess,
  type LocalProofMutationSuccess,
} from "@breev/contracts/local-rest";
import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { IdentityAccessService } from "../identity-access/identity-access.service.js";
import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import { MainDeviceSecurityService } from "./main-device-security.service.js";

@Controller()
export class MainDeviceProofController {
  public constructor(
    private readonly security: MainDeviceSecurityService,
    private readonly identity: IdentityAccessService,
  ) {}

  @Post(localProofMutationContract.path)
  @HttpCode(LOCAL_PROOF_MUTATION_SUCCESS_STATUS)
  public async mutate(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<LocalProofMutationSuccess> {
    if (!localProofMutationRequestSchema.safeParse(body).success) {
      return await this.security.deny(
        "body-invalid",
        400,
        "proof-mutation",
        "verified",
        this.security.verifiedDeviceId(request),
      );
    }
    return await translateIdentityDenial(async () => {
      await this.identity.requireIdentityAfterBootstrap(request);
      return await this.security.mutate();
    });
  }

  @Get(localProofEvidenceContract.path)
  public async evidence(): Promise<LocalProofEvidenceSuccess> {
    return await this.security.evidence();
  }
}
