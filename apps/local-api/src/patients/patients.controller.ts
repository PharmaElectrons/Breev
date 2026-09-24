import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import {
  createPatientRequestSchema,
  updatePatientRequestSchema,
  updatePatientNotesRequestSchema,
  updatePatientDiscountRequestSchema,
  updatePatientDndRequestSchema,
  addPatientWeightRequestSchema,
  searchPatientsQuerySchema,
  listPatientWeightsQuerySchema,
  BREEV_CSRF_HEADER,
  BREEV_CSRF_VALUE,
  searchPatientsContract,
  createPatientContract,
  getPatientContract,
  updatePatientProfileContract,
  updatePatientNotesContract,
  updatePatientDiscountContract,
  updatePatientDndContract,
  listPatientWeightsContract,
  addPatientWeightContract,
  archivePatientContract,
  archivePatientRequestSchema,
  restorePatientContract,
  restorePatientRequestSchema,
} from "@breev/contracts/local-rest";
import {
  PatientsService,
  PatientConflictError,
  PatientNotFoundError,
  PatientValidationError,
} from "./patients.service.js";
import { ExactDecimalError } from "./patient-exact-decimal.js";
import { categorizeBmi } from "./patient-bmi.js";
import {
  IdentityAccessService,
  IdentityAccessDenied,
} from "../identity-access/identity-access.service.js";
import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import type { ActorContext } from "./patient-auth.port.js";

async function translatePatientErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof PatientConflictError) {
      throw new HttpException(
        { code: "patient-conflict", message: error.message },
        409,
      );
    }
    if (error instanceof PatientNotFoundError) {
      throw new HttpException(
        { code: "patient-not-found", message: error.message },
        404,
      );
    }
    if (error instanceof PatientValidationError) {
      throw new HttpException(
        {
          code: "validation-failed",
          message: error.message,
          errors: error.errors,
        },
        400,
      );
    }
    if (error instanceof ExactDecimalError) {
      throw new HttpException(
        {
          code: "invalid-decimal",
          message: error.message,
        },
        400,
      );
    }
    throw error;
  }
}

function parseOrThrow<T>(
  schema: { parse: (val: unknown) => T },
  data: unknown,
): T {
  try {
    return schema.parse(data);
  } catch (error) {
    throw new HttpException(
      {
        code: "invalid-payload",
        message: error instanceof Error ? error.message : "Validation failed",
      },
      400,
    );
  }
}

@Controller()
export class PatientsController {
  constructor(
    private readonly service: PatientsService,
    private readonly identity: IdentityAccessService,
  ) {}

  @Get(searchPatientsContract.path)
  public async searchPatients(
    @Req() request: Request,
    @Query() rawQuery: unknown,
  ) {
    const query = parseOrThrow(searchPatientsQuerySchema, rawQuery);
    try {
      const context = await this.identity.requirePermission(
        request,
        "patients.view",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      return await this.service.searchPatients(
        actor,
        query.q,
        query.page,
        query.limit,
      );
    } catch (error) {
      if (error instanceof IdentityAccessDenied) {
        // Zero-leakage: return empty list on denial instead of 403
        return {
          items: [],
          total: 0,
          page: query.page,
          limit: query.limit,
          totalPages: 0,
        };
      }
      throw error;
    }
  }

  @Post(createPatientContract.path)
  @HttpCode(201)
  public async createPatient(
    @Req() request: Request,
    @Headers(BREEV_CSRF_HEADER) csrf: string | undefined,
    @Body() rawBody: unknown,
  ) {
    return await translatePatientErrors(async () => {
      if (csrf !== BREEV_CSRF_VALUE) {
        throw new HttpException({ code: "csrf-rejected" }, 403);
      }
      const context = await this.identity.requirePermission(
        request,
        "patients.manage",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      const body = parseOrThrow(createPatientRequestSchema, rawBody);

      return await this.service.createPatient(actor, body);
    });
  }

  @Get(getPatientContract.path)
  public async getPatient(@Req() request: Request, @Param("id") id: string) {
    return await translatePatientErrors(async () => {
      const context = await this.identity.requirePermission(
        request,
        "patients.view",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      const patient = await this.service.getPatientById(actor, id);
      return {
        ...patient,
        bmiCategory: categorizeBmi(patient.bmi),
      };
    });
  }

  @Patch(updatePatientProfileContract.path)
  public async updatePatientProfile(
    @Req() request: Request,
    @Headers(BREEV_CSRF_HEADER) csrf: string | undefined,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ) {
    return await translatePatientErrors(async () => {
      if (csrf !== BREEV_CSRF_VALUE) {
        throw new HttpException({ code: "csrf-rejected" }, 403);
      }
      const context = await this.identity.requirePermission(
        request,
        "patients.manage",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      const body = parseOrThrow(updatePatientRequestSchema, rawBody);

      return await this.service.updatePatientProfile(actor, id, body);
    });
  }

  @Patch(updatePatientNotesContract.path)
  public async updatePatientNotes(
    @Req() request: Request,
    @Headers(BREEV_CSRF_HEADER) csrf: string | undefined,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ) {
    return await translatePatientErrors(async () => {
      if (csrf !== BREEV_CSRF_VALUE) {
        throw new HttpException({ code: "csrf-rejected" }, 403);
      }
      const context = await this.identity.requirePermission(
        request,
        "patients.notes.manage",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      const body = parseOrThrow(updatePatientNotesRequestSchema, rawBody);

      return await this.service.updatePatientNotes(actor, id, body);
    });
  }

  @Patch(updatePatientDiscountContract.path)
  public async updatePatientDiscount(
    @Req() request: Request,
    @Headers(BREEV_CSRF_HEADER) csrf: string | undefined,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ) {
    return await translatePatientErrors(async () => {
      if (csrf !== BREEV_CSRF_VALUE) {
        throw new HttpException({ code: "csrf-rejected" }, 403);
      }
      const context = await this.identity.requirePermission(
        request,
        "patients.discounts.manage",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      const body = parseOrThrow(updatePatientDiscountRequestSchema, rawBody);

      return await this.service.updatePatientDiscount(actor, id, body);
    });
  }

  @Patch(updatePatientDndContract.path)
  public async updatePatientDnd(
    @Req() request: Request,
    @Headers(BREEV_CSRF_HEADER) csrf: string | undefined,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ) {
    return await translatePatientErrors(async () => {
      if (csrf !== BREEV_CSRF_VALUE) {
        throw new HttpException({ code: "csrf-rejected" }, 403);
      }
      const context = await this.identity.requirePermission(
        request,
        "patients.manage",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      const body = parseOrThrow(updatePatientDndRequestSchema, rawBody);

      return await this.service.updatePatientDnd(actor, id, body);
    });
  }

  @Get(listPatientWeightsContract.path)
  public async listWeights(
    @Req() request: Request,
    @Param("id") id: string,
    @Query() rawQuery: unknown,
  ) {
    return await translatePatientErrors(async () => {
      const context = await this.identity.requirePermission(
        request,
        "patients.view",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      const query = parseOrThrow(listPatientWeightsQuerySchema, rawQuery);

      return await this.service.listWeights(actor, id, query.page, query.limit);
    });
  }

  @Post(addPatientWeightContract.path)
  @HttpCode(201)
  public async addWeight(
    @Req() request: Request,
    @Headers(BREEV_CSRF_HEADER) csrf: string | undefined,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ) {
    return await translatePatientErrors(async () => {
      if (csrf !== BREEV_CSRF_VALUE) {
        throw new HttpException({ code: "csrf-rejected" }, 403);
      }
      const context = await this.identity.requirePermission(
        request,
        "patients.manage",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      const body = parseOrThrow(addPatientWeightRequestSchema, rawBody);

      return await this.service.addWeight(actor, id, body);
    });
  }

  @Patch(archivePatientContract.path)
  public async archivePatient(
    @Req() request: Request,
    @Headers(BREEV_CSRF_HEADER) csrf: string | undefined,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ) {
    return await translatePatientErrors(async () => {
      if (csrf !== BREEV_CSRF_VALUE) {
        throw new HttpException({ code: "csrf-rejected" }, 403);
      }
      const context = await this.identity.requirePermission(
        request,
        "patients.manage",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      const body = parseOrThrow(archivePatientRequestSchema, rawBody);

      return await this.service.archivePatient(actor, id, body.updatedAt);
    });
  }

  @Patch(restorePatientContract.path)
  public async restorePatient(
    @Req() request: Request,
    @Headers(BREEV_CSRF_HEADER) csrf: string | undefined,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ) {
    return await translatePatientErrors(async () => {
      if (csrf !== BREEV_CSRF_VALUE) {
        throw new HttpException({ code: "csrf-rejected" }, 403);
      }
      const context = await this.identity.requirePermission(
        request,
        "patients.manage",
      );
      const actor: ActorContext = {
        deviceId: context.deviceId,
        userId: context.actorId,
      };
      const body = parseOrThrow(restorePatientRequestSchema, rawBody);

      return await this.service.restorePatient(actor, id, body.updatedAt);
    });
  }
}
