import {
  LOCAL_PROOF_MUTATION_SUCCESS_STATUS,
  localProofEvidenceContract,
  localProofMutationContract,
  localProofMutationRequestSchema,
  type LocalProofEvidenceSuccess,
  type LocalProofMutationSuccess,
} from "@breev/contracts/local-rest";
import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";

import { MainDeviceSecurityService } from "./main-device-security.service.js";

@Controller()
export class MainDeviceProofController {
  public constructor(private readonly security: MainDeviceSecurityService) {}

  @Post(localProofMutationContract.path)
  @HttpCode(LOCAL_PROOF_MUTATION_SUCCESS_STATUS)
  public async mutate(
    @Body() body: unknown,
  ): Promise<LocalProofMutationSuccess> {
    if (!localProofMutationRequestSchema.safeParse(body).success) {
      return await this.security.deny("body-invalid", 400);
    }
    return await this.security.mutate();
  }

  @Get(localProofEvidenceContract.path)
  public async evidence(): Promise<LocalProofEvidenceSuccess> {
    return await this.security.evidence();
  }
}
