import {
  deviceInventoryContract,
  deviceRevocationContract,
  deviceRevocationRequestSchema,
  identityResourceIdSchema,
  pairingSessionCancelContract,
  pairingSessionCancelRequestSchema,
  pairingSessionConfirmContract,
  pairingSessionConfirmRequestSchema,
  pairingSessionCurrentContract,
  pairingSessionStartContract,
  pairingSessionStartRequestSchema,
  seatReleaseApprovalContract,
  seatReleaseApprovalRequestSchema,
  seatReleaseRequestContract,
  seatReleaseRequestCreateSchema,
  type DeviceInventory,
  type DeviceRevocation,
  type PairingSessionCancelled,
  type PairingSessionConfirmed,
  type PairingSessionStarted,
  type PairingSessionView,
  type SeatReleaseApproval,
  type SeatReleaseRequest,
} from "@breev/contracts/local-rest";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { IdentityAccessService } from "../identity-access/identity-access.service.js";
import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import { DevicesDenied } from "./devices-audit.js";
import { DevicesService } from "./devices.service.js";

@Controller()
export class DevicesController {
  public constructor(
    private readonly devices: DevicesService,
    private readonly identity: IdentityAccessService,
  ) {}

  @Post(pairingSessionStartContract.path)
  @HttpCode(201)
  public async startPairingSession(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PairingSessionStarted> {
    return await translateDevicesDenial(() =>
      translateIdentityDenial(async () => {
        const input = pairingSessionStartRequestSchema.safeParse(body);
        if (!input.success) {
          return await this.identity.rejectInvalidBody(request);
        }
        return await this.devices.startPairingSession(request, input.data);
      }),
    );
  }

  @Get(pairingSessionCurrentContract.path)
  public async currentPairingSession(
    @Req() request: Request,
  ): Promise<PairingSessionView> {
    return await translateDevicesDenial(() =>
      translateIdentityDenial(() =>
        this.devices.currentPairingSession(request),
      ),
    );
  }

  @Post(pairingSessionConfirmContract.path)
  @HttpCode(201)
  public async confirmPairingSession(
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PairingSessionConfirmed> {
    return await translateDevicesDenial(() =>
      translateIdentityDenial(async () => {
        const parsedId = identityResourceIdSchema.safeParse(sessionId);
        const input = pairingSessionConfirmRequestSchema.safeParse(body);
        if (!parsedId.success || !input.success) {
          return await this.identity.rejectInvalidBody(request);
        }
        return await this.devices.confirmPairingSession(
          request,
          parsedId.data,
          input.data,
        );
      }),
    );
  }

  @Post(pairingSessionCancelContract.path)
  @HttpCode(201)
  public async cancelPairingSession(
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<PairingSessionCancelled> {
    return await translateDevicesDenial(() =>
      translateIdentityDenial(async () => {
        const parsedId = identityResourceIdSchema.safeParse(sessionId);
        const input = pairingSessionCancelRequestSchema.safeParse(body);
        if (!parsedId.success || !input.success) {
          return await this.identity.rejectInvalidBody(request);
        }
        return await this.devices.cancelPairingSession(
          request,
          parsedId.data,
          input.data,
        );
      }),
    );
  }

  @Get(deviceInventoryContract.path)
  public async inventory(@Req() request: Request): Promise<DeviceInventory> {
    return await translateDevicesDenial(() =>
      translateIdentityDenial(() => this.devices.inventory(request)),
    );
  }

  @Post(deviceRevocationContract.path)
  @HttpCode(201)
  public async revokeDevice(
    @Param("deviceId") deviceId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<DeviceRevocation> {
    return await translateDevicesDenial(() =>
      translateIdentityDenial(async () => {
        const parsedId = identityResourceIdSchema.safeParse(deviceId);
        const input = deviceRevocationRequestSchema.safeParse(body);
        if (!parsedId.success || !input.success) {
          return await this.identity.rejectInvalidBody(request);
        }
        return await this.devices.revokeDevice(
          request,
          parsedId.data,
          input.data,
        );
      }),
    );
  }

  @Post(seatReleaseRequestContract.path)
  @HttpCode(201)
  public async requestSeatRelease(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<SeatReleaseRequest> {
    return await translateDevicesDenial(() =>
      translateIdentityDenial(async () => {
        const input = seatReleaseRequestCreateSchema.safeParse(body);
        if (!input.success) {
          return await this.identity.rejectInvalidBody(request);
        }
        return await this.devices.requestSeatRelease(request, input.data);
      }),
    );
  }

  @Post(seatReleaseApprovalContract.path)
  @HttpCode(201)
  public async approveSeatRelease(
    @Param("requestId") requestId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<SeatReleaseApproval> {
    return await translateDevicesDenial(() =>
      translateIdentityDenial(async () => {
        const parsedId = identityResourceIdSchema.safeParse(requestId);
        const input = seatReleaseApprovalRequestSchema.safeParse(body);
        if (!parsedId.success || !input.success) {
          return await this.identity.rejectInvalidBody(request);
        }
        return await this.devices.approveSeatRelease(
          request,
          parsedId.data,
          input.data,
        );
      }),
    );
  }
}

export async function translateDevicesDenial<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DevicesDenied) {
      throw new HttpException(error.denial, error.statusCode);
    }
    throw error;
  }
}
