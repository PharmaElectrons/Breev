import {
  attendanceEventContract,
  attendanceEventRequestSchema,
  identityBootstrapContract,
  identityBootstrapRequestSchema,
  identityChangePasswordContract,
  identityChangePasswordRequestSchema,
  identityCreateUserContract,
  identityCreateUserRequestSchema,
  identityLoginContract,
  identityLoginRequestSchema,
  identityLogoutContract,
  identityLogoutRequestSchema,
  identityResourceIdSchema,
  identityResetUserPasswordContract,
  identityResetUserPasswordRequestSchema,
  identityRolesContract,
  identityStateContract,
  identityStepUpApproveContract,
  identityStepUpApproveRequestSchema,
  identityStepUpCreateContract,
  identityStepUpCreateRequestSchema,
  identityUpdateRolePermissionsContract,
  identityUpdateRolePermissionsRequestSchema,
  identityUpdateUserContract,
  identityUpdateUserRequestSchema,
  identityUsersContract,
  pharmacySettingsContract,
  pharmacySettingsUpdateRequestSchema,
  type AttendanceEvent,
  type IdentityAuthenticatedState,
  type IdentityRole,
  type IdentityRoles,
  type IdentityState,
  type IdentityStepUpChallenge,
  type IdentityUser,
  type PharmacySettings,
} from "@breev/contracts/local-rest";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { LicensingDenied } from "../licensing/licensing.service.js";
import {
  IdentityAccessDenied,
  IdentityAccessService,
} from "./identity-access.service.js";

@Controller()
export class IdentityAccessController {
  public constructor(private readonly identity: IdentityAccessService) {}

  @Get(identityStateContract.path)
  public async state(@Req() request: Request): Promise<IdentityState> {
    return await this.identity.state(request);
  }

  @Post(identityBootstrapContract.path)
  @HttpCode(201)
  public async bootstrap(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<IdentityAuthenticatedState> {
    return await translateIdentityDenial(async () => {
      const input = identityBootstrapRequestSchema.safeParse(body);
      if (!input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.bootstrap(request, input.data);
    });
  }

  @Post(identityLoginContract.path)
  @HttpCode(200)
  public async login(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<IdentityAuthenticatedState> {
    return await translateIdentityDenial(async () => {
      const input = identityLoginRequestSchema.safeParse(body);
      if (!input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.login(request, input.data);
    });
  }

  @Post(identityLogoutContract.path)
  @HttpCode(204)
  public async logout(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<void> {
    return await translateIdentityDenial(async () => {
      if (!identityLogoutRequestSchema.safeParse(body).success) {
        return await this.identity.rejectInvalidBody(request);
      }
      await this.identity.logout(request);
    });
  }

  @Get(identityRolesContract.path)
  public async roles(@Req() request: Request): Promise<IdentityRoles> {
    return await translateIdentityDenial(() => this.identity.roles(request));
  }

  @Get(identityUsersContract.path)
  public async users(
    @Req() request: Request,
  ): Promise<{ users: IdentityUser[] }> {
    return await translateIdentityDenial(() => this.identity.users(request));
  }

  @Post(identityCreateUserContract.path)
  @HttpCode(201)
  public async createUser(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<IdentityUser> {
    return await translateIdentityDenial(async () => {
      const input = identityCreateUserRequestSchema.safeParse(body);
      if (!input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.createUser(request, input.data);
    });
  }

  @Patch(identityUpdateUserContract.path)
  public async updateUser(
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<IdentityUser> {
    return await translateIdentityDenial(async () => {
      const parsedId = identityResourceIdSchema.safeParse(userId);
      const input = identityUpdateUserRequestSchema.safeParse(body);
      if (!parsedId.success || !input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.updateUser(request, parsedId.data, input.data);
    });
  }

  @Post(identityChangePasswordContract.path)
  @HttpCode(200)
  public async changePassword(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<IdentityUser> {
    return await translateIdentityDenial(async () => {
      const input = identityChangePasswordRequestSchema.safeParse(body);
      if (!input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.changePassword(request, input.data);
    });
  }

  @Post(identityResetUserPasswordContract.path)
  @HttpCode(200)
  public async resetUserPassword(
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<IdentityUser> {
    return await translateIdentityDenial(async () => {
      const parsedId = identityResourceIdSchema.safeParse(userId);
      const input = identityResetUserPasswordRequestSchema.safeParse(body);
      if (!parsedId.success || !input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.resetUserPassword(
        request,
        parsedId.data,
        input.data,
      );
    });
  }

  @Post(identityStepUpCreateContract.path)
  @HttpCode(201)
  public async createStepUp(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<IdentityStepUpChallenge> {
    return await translateIdentityDenial(async () => {
      const input = identityStepUpCreateRequestSchema.safeParse(body);
      if (!input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.createStepUp(request, input.data);
    });
  }

  @Post(identityStepUpApproveContract.path)
  @HttpCode(200)
  public async approveStepUp(
    @Param("challengeId") challengeId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<IdentityStepUpChallenge> {
    return await translateIdentityDenial(async () => {
      const parsedId = identityResourceIdSchema.safeParse(challengeId);
      const input = identityStepUpApproveRequestSchema.safeParse(body);
      if (!parsedId.success || !input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.approveStepUp(
        request,
        parsedId.data,
        input.data,
      );
    });
  }

  @Put(identityUpdateRolePermissionsContract.path)
  public async updateRolePermissions(
    @Param("roleId") roleId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<IdentityRole> {
    return await translateIdentityDenial(async () => {
      const parsedId = identityResourceIdSchema.safeParse(roleId);
      const input = identityUpdateRolePermissionsRequestSchema.safeParse(body);
      if (!parsedId.success || !input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.updateRolePermissions(
        request,
        parsedId.data,
        input.data,
      );
    });
  }

  @Patch(pharmacySettingsContract.path)
  public async updateSettings(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PharmacySettings> {
    return await translateIdentityDenial(async () => {
      const input = pharmacySettingsUpdateRequestSchema.safeParse(body);
      if (!input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.updateSettings(request, input.data);
    });
  }

  @Post(attendanceEventContract.path)
  @HttpCode(201)
  public async attendance(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<AttendanceEvent> {
    return await translateIdentityDenial(async () => {
      const input = attendanceEventRequestSchema.safeParse(body);
      if (!input.success) {
        return await this.identity.rejectInvalidBody(request);
      }
      return await this.identity.recordAttendance(request, input.data);
    });
  }
}

/**
 * Turns a decision into its HTTP response.
 *
 * Two families reach here. An identity denial carries its own status. A
 * licensing denial reaches this path too, because establishing an Additional
 * POS Terminal's execution context requires the entitlement that permits a
 * terminal at all: a terminal whose licence no longer carries it is refused
 * with `entitlement-denied`, and the Main Pharmacy Computer never is. Anything
 * else is a fault and is left alone rather than dressed up as a decision.
 */
async function translateIdentityDenial<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof IdentityAccessDenied) {
      throw new HttpException(error.denial, error.statusCode);
    }
    if (error instanceof LicensingDenied) {
      throw new HttpException(
        error.denial,
        error.denial.code === "idempotency-conflict" ? 409 : 403,
      );
    }
    throw error;
  }
}

export { translateIdentityDenial };
