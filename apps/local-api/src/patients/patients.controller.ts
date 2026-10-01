import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import {
  createPatientContract,
  createPatientRequestSchema,
  getPatientContract,
  listPatientWeightsContract,
  listPatientWeightsQuerySchema,
  patientIdSchema,
  searchPatientsContract,
  searchPatientsQuerySchema,
  updatePatientProfileContract,
  updatePatientRequestSchema,
} from "@breev/contracts/local-rest";
import { translateIdentityDenial } from "../identity-access/identity-access.controller.js";
import { IdentityAccessService } from "../identity-access/identity-access.service.js";
import {
  PatientCommandError,
  PatientValidationError,
  PatientsService,
} from "./patients.service.js";

interface ParseFailure {
  readonly success: false;
  readonly error: {
    readonly issues: readonly {
      readonly path: readonly unknown[];
    }[];
  };
}

interface ParseSuccess<T> {
  readonly success: true;
  readonly data: T;
}

interface RuntimeSchema<T> {
  safeParse(value: unknown): ParseSuccess<T> | ParseFailure;
}

function parseOrThrow<T>(schema: RuntimeSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = new Set(
    result.error.issues.map((issue) => String(issue.path[0] ?? "body")),
  );
  throw new PatientValidationError(
    [...fields].map((field) => ({ field, code: "invalid" as const })),
  );
}

async function translatePatientErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await translateIdentityDenial(work);
  } catch (error) {
    if (error instanceof PatientCommandError) {
      throw new HttpException(
        error.body as Record<string, unknown>,
        error.statusCode,
      );
    }
    if (error instanceof PatientValidationError) {
      throw new HttpException(
        { code: "validation-failed", errors: error.errors },
        400,
      );
    }
    throw error;
  }
}

function includesAnyNotesField(value: Record<string, unknown>): boolean {
  return [
    "allergies",
    "smoking",
    "sensitivities",
    "otherNotes",
    "chronicConditions",
    "chronicMedications",
  ].some((field) => Object.hasOwn(value, field));
}

@Controller()
export class PatientsController {
  public constructor(
    private readonly service: PatientsService,
    private readonly identity: IdentityAccessService,
  ) {}

  @Get(searchPatientsContract.path)
  public async searchPatients(
    @Req() request: Request,
    @Query() rawQuery: unknown,
  ) {
    return await translatePatientErrors(async () => {
      const context = await this.identity.requirePermission(
        request,
        "patients.view",
      );
      const query = parseOrThrow(searchPatientsQuerySchema, rawQuery);
      return await this.service.searchPatients(
        context,
        query.q,
        query.page,
        query.limit,
      );
    });
  }

  @Post(createPatientContract.path)
  @HttpCode(201)
  public async createPatient(
    @Req() request: Request,
    @Body() rawBody: unknown,
  ) {
    return await translatePatientErrors(async () => {
      let context = await this.identity.requirePermission(
        request,
        "patients.manage",
      );
      const body = parseOrThrow(createPatientRequestSchema, rawBody);
      if (includesAnyNotesField(body)) {
        context = await this.identity.requirePermission(
          request,
          "patients.notes.manage",
        );
      }
      if (Object.hasOwn(body, "discountPercent")) {
        context = await this.identity.requirePermission(
          request,
          "patients.discounts.manage",
        );
      }
      return await this.service.createPatient(context, body);
    });
  }

  @Get(getPatientContract.path)
  public async getPatient(@Req() request: Request, @Param("id") rawId: string) {
    return await translatePatientErrors(async () => {
      const context = await this.identity.requirePermission(
        request,
        "patients.view",
      );
      const id = parseOrThrow(patientIdSchema, rawId);
      return await this.service.getPatientById(context, id);
    });
  }

  @Put(updatePatientProfileContract.path)
  @HttpCode(200)
  public async updatePatientProfile(
    @Req() request: Request,
    @Param("id") rawId: string,
    @Body() rawBody: unknown,
  ) {
    return await translatePatientErrors(async () => {
      let context = await this.identity.requirePermission(
        request,
        "patients.manage",
      );
      const id = parseOrThrow(patientIdSchema, rawId);
      const body = parseOrThrow(updatePatientRequestSchema, rawBody);
      if (includesAnyNotesField(body)) {
        context = await this.identity.requirePermission(
          request,
          "patients.notes.manage",
        );
      }
      if (Object.hasOwn(body, "discountPercent")) {
        context = await this.identity.requirePermission(
          request,
          "patients.discounts.manage",
        );
      }
      return await this.service.updatePatientProfile(context, id, body);
    });
  }

  @Get(listPatientWeightsContract.path)
  public async listWeights(
    @Req() request: Request,
    @Param("id") rawId: string,
    @Query() rawQuery: unknown,
  ) {
    return await translatePatientErrors(async () => {
      const context = await this.identity.requirePermission(
        request,
        "patients.view",
      );
      const id = parseOrThrow(patientIdSchema, rawId);
      const query = parseOrThrow(listPatientWeightsQuerySchema, rawQuery);
      return await this.service.listWeights(
        context,
        id,
        query.page,
        query.limit,
      );
    });
  }
}
