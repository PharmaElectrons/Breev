import { Injectable } from "@nestjs/common";
import type {
  CreatePatientRequest,
  ListPatientWeightsResponse,
  PatientProfileResponse,
  SearchPatientsResponse,
  UpdatePatientRequest,
} from "@breev/contracts/local-rest";
import { patientProfileResponseSchema } from "@breev/contracts/local-rest";
import type { PoolClient } from "pg";

import {
  IdentityAccessService,
  type IdentityExecutionContext,
} from "../identity-access/identity-access.service.js";
import { hasPermission } from "../identity-access/authorization.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { writePostingAudit } from "../posting/audit-writer.js";
import {
  canonicalRequestHash,
  type JsonObject,
} from "../posting/canonical-hash.js";
import { runWholeCommandWithRetry } from "../posting/command-retry.js";
import {
  PostingIdempotencyConflict,
  beginPostingIdempotency,
  recordPostingResult,
} from "../posting/idempotency.js";
import { categorizeBmi } from "./patient-bmi.js";
import {
  ExactDecimalError,
  parseExactDiscount,
  parseExactHeight,
  parseExactWeight,
} from "./patient-exact-decimal.js";
import { normalizeSearchQuery } from "./patient-validation.js";
import { PatientsRepository } from "./patients.repository.js";

const CREATE_COMMAND = "patients.create";
const SAVE_COMMAND = "patients.save";
const NOTES_FIELDS = [
  "allergies",
  "smoking",
  "sensitivities",
  "otherNotes",
  "chronicConditions",
  "chronicMedications",
] as const;

export interface PatientFieldError {
  readonly field: string;
  readonly code: "invalid";
}

export class PatientValidationError extends Error {
  public constructor(public readonly errors: readonly PatientFieldError[]) {
    super("Patient request validation failed");
    this.name = "PatientValidationError";
  }
}

export class PatientCommandError extends Error {
  public constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly body: unknown,
  ) {
    super("Patient command rejected");
    this.name = "PatientCommandError";
  }
}

interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

function hasAnyNotesField(
  input: CreatePatientRequest | UpdatePatientRequest,
): boolean {
  return NOTES_FIELDS.some((field) => Object.hasOwn(input, field));
}

function mayViewNotes(context: IdentityExecutionContext): boolean {
  return (
    hasPermission(context.permissions, "patients.notes.view") ||
    hasPermission(context.permissions, "patients.notes.manage")
  );
}

function profileProjection(
  patient: PatientProfileResponse,
  context: IdentityExecutionContext,
): PatientProfileResponse {
  const category = patient.bmi === null ? null : categorizeBmi(patient.bmi);
  const withBmiCategory = {
    ...patient,
    bmiCategory: category === "unknown" ? null : category,
  };
  if (mayViewNotes(context)) return withBmiCategory;
  const safe: Partial<PatientProfileResponse> = { ...withBmiCategory };
  for (const field of NOTES_FIELDS) delete safe[field];
  return safe as PatientProfileResponse;
}

function fieldsSupplied(
  input: CreatePatientRequest | UpdatePatientRequest,
): string[] {
  return Object.keys(input).filter(
    (key) => key !== "idempotencyKey" && key !== "expectedRevision",
  );
}

function requiredSavePermissions(
  input: CreatePatientRequest | UpdatePatientRequest,
): readonly (
  "patients.manage" | "patients.notes.manage" | "patients.discounts.manage"
)[] {
  const permissions: (
    "patients.manage" | "patients.notes.manage" | "patients.discounts.manage"
  )[] = ["patients.manage"];
  if (hasAnyNotesField(input)) permissions.push("patients.notes.manage");
  if (Object.hasOwn(input, "discountPercent")) {
    permissions.push("patients.discounts.manage");
  }
  return permissions;
}

function validateExactFields(
  input: CreatePatientRequest | UpdatePatientRequest,
): void {
  try {
    if (input.heightCm !== undefined && input.heightCm !== null) {
      parseExactHeight(input.heightCm);
    }
    if (input.discountPercent !== undefined && input.discountPercent !== null) {
      parseExactDiscount(input.discountPercent);
    }
    if (input.weightMeasurement !== undefined) {
      parseExactWeight(input.weightMeasurement.weightKg);
    }
  } catch (error) {
    if (!(error instanceof ExactDecimalError)) throw error;
    const field = error.message.startsWith("Height")
      ? "heightCm"
      : error.message.startsWith("Discount")
        ? "discountPercent"
        : "weightMeasurement.weightKg";
    throw new PatientValidationError([{ field, code: "invalid" }]);
  }
}

@Injectable()
export class PatientsService {
  public constructor(
    private readonly database: LocalDatabaseService,
    private readonly repository: PatientsRepository,
    private readonly identity: IdentityAccessService,
  ) {}

  public async searchPatients(
    context: IdentityExecutionContext,
    query: string | undefined,
    page: number,
    limit: number,
  ): Promise<SearchPatientsResponse> {
    const normalizedQuery = normalizeSearchQuery(query) ?? undefined;
    const client = await this.database.requirePool().connect();
    try {
      await client.query("begin");
      const fresh = await this.identity.revalidatePatientOperation(
        client,
        context,
        ["patients.view"],
      );
      const result = await this.repository.searchPatients(
        client,
        fresh.pharmacyId,
        normalizedQuery,
        limit,
        (page - 1) * limit,
      );
      await this.auditRead(client, fresh, "patients.search", undefined, {
        page,
        queryPresent: normalizedQuery !== undefined,
        resultCount: result.items.length,
        total: result.total,
      });
      await client.query("commit");
      return {
        items: result.items.map((patient) => profileProjection(patient, fresh)),
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async getPatientById(
    context: IdentityExecutionContext,
    id: string,
  ): Promise<PatientProfileResponse> {
    const client = await this.database.requirePool().connect();
    try {
      await client.query("begin");
      const fresh = await this.identity.revalidatePatientOperation(
        client,
        context,
        ["patients.view"],
      );
      const patient = await this.repository.getPatientById(
        client,
        fresh.pharmacyId,
        id,
      );
      if (patient === null) {
        await this.auditRead(client, fresh, "patients.profile.read", id, {
          outcome: "not-found",
        });
        await client.query("commit");
        throw new PatientCommandError(404, { code: "patient-not-found" });
      }
      const projected = profileProjection(patient, fresh);
      await this.auditRead(client, fresh, "patients.profile.read", id, {
        notesIncluded: mayViewNotes(fresh),
      });
      await client.query("commit");
      return projected;
    } catch (error) {
      if (!(error instanceof PatientCommandError)) {
        await client.query("rollback").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async listWeights(
    context: IdentityExecutionContext,
    patientId: string,
    page: number,
    limit: number,
  ): Promise<ListPatientWeightsResponse> {
    const client = await this.database.requirePool().connect();
    try {
      await client.query("begin");
      const fresh = await this.identity.revalidatePatientOperation(
        client,
        context,
        ["patients.view"],
      );
      const businessTimeZone = await this.identity.readPharmacyBusinessTimeZone(
        client,
        fresh.pharmacyId,
      );
      const patient = await this.repository.getPatientById(
        client,
        fresh.pharmacyId,
        patientId,
      );
      if (patient === null) {
        await this.auditRead(
          client,
          fresh,
          "patients.weights.read",
          patientId,
          {
            outcome: "not-found",
          },
        );
        await client.query("commit");
        throw new PatientCommandError(404, { code: "patient-not-found" });
      }
      const weights = await this.repository.listWeights(
        client,
        fresh.pharmacyId,
        patientId,
        limit,
        (page - 1) * limit,
      );
      await this.auditRead(client, fresh, "patients.weights.read", patientId, {
        page,
        resultCount: weights.items.length,
        total: weights.total,
      });
      await client.query("commit");
      return {
        ...weights,
        businessTimeZone,
        page,
        limit,
        totalPages: Math.ceil(weights.total / limit),
      };
    } catch (error) {
      if (!(error instanceof PatientCommandError)) {
        await client.query("rollback").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async createPatient(
    context: IdentityExecutionContext,
    input: CreatePatientRequest,
  ): Promise<PatientProfileResponse> {
    validateExactFields(input);
    const result = await this.executeCommand(
      context,
      CREATE_COMMAND,
      input.idempotencyKey,
      canonicalRequestHash(CREATE_COMMAND, input),
      requiredSavePermissions(input),
      201,
      fieldsSupplied(input),
      async (client, fresh) => {
        const created = await this.repository.createPatient(
          client,
          fresh.pharmacyId,
          input,
        );
        if (input.weightMeasurement !== undefined) {
          await this.repository.appendWeight(
            client,
            fresh.pharmacyId,
            created.id,
            fresh.actorId,
            input.weightMeasurement.weightKg,
            input.weightMeasurement.measuredAt,
          );
        }
        const patient =
          input.weightMeasurement === undefined
            ? created
            : ((await this.repository.getPatientById(
                client,
                fresh.pharmacyId,
                created.id,
              )) ?? created);
        const body = profileProjection(patient, fresh);
        await this.auditMutation(
          client,
          fresh,
          input.idempotencyKey,
          "patients.create",
          body.id,
          { fields: fieldsSupplied(input) },
          { revision: body.revision },
        );
        return { status: 201, body };
      },
    );
    return result as PatientProfileResponse;
  }

  public async updatePatientProfile(
    context: IdentityExecutionContext,
    id: string,
    input: UpdatePatientRequest,
  ): Promise<PatientProfileResponse> {
    validateExactFields(input);
    const commandBody = { patientId: id, request: input };
    const result = await this.executeCommand(
      context,
      SAVE_COMMAND,
      input.idempotencyKey,
      canonicalRequestHash(SAVE_COMMAND, commandBody),
      requiredSavePermissions(input),
      200,
      fieldsSupplied(input),
      async (client, fresh) => {
        const before = await this.repository.getPatientById(
          client,
          fresh.pharmacyId,
          id,
          true,
        );
        if (before === null) {
          await this.auditMutation(
            client,
            fresh,
            input.idempotencyKey,
            SAVE_COMMAND,
            id,
            undefined,
            undefined,
            "not-found",
          );
          return { status: 404, body: { code: "patient-not-found" } };
        }
        if (before.revision !== input.expectedRevision) {
          const body = {
            code: "version-conflict",
            currentRevision: before.revision,
          } as const;
          await this.auditMutation(
            client,
            fresh,
            input.idempotencyKey,
            SAVE_COMMAND,
            id,
            { expectedRevision: input.expectedRevision },
            { currentRevision: before.revision },
            "version-conflict",
          );
          return { status: 409, body };
        }
        const updated = await this.repository.updatePatient(
          client,
          fresh.pharmacyId,
          id,
          input.expectedRevision,
          input,
        );
        if (updated === null) {
          throw new Error("Locked patient update unexpectedly missed its row");
        }
        if (input.weightMeasurement !== undefined) {
          await this.repository.appendWeight(
            client,
            fresh.pharmacyId,
            id,
            fresh.actorId,
            input.weightMeasurement.weightKg,
            input.weightMeasurement.measuredAt,
          );
        }
        const patient =
          input.weightMeasurement === undefined
            ? updated
            : ((await this.repository.getPatientById(
                client,
                fresh.pharmacyId,
                id,
              )) ?? updated);
        const body = profileProjection(patient, fresh);
        await this.auditMutation(
          client,
          fresh,
          input.idempotencyKey,
          SAVE_COMMAND,
          id,
          { revision: before.revision },
          { revision: body.revision, fields: fieldsSupplied(input) },
        );
        return { status: 200, body };
      },
      id,
    );
    return result as PatientProfileResponse;
  }

  private async executeCommand(
    context: IdentityExecutionContext,
    commandName: string,
    idempotencyKey: string,
    requestHash: Buffer,
    permissions: readonly (
      "patients.manage" | "patients.notes.manage" | "patients.discounts.manage"
    )[],
    successStatus: 200 | 201,
    requestFields: readonly string[],
    work: (
      client: PoolClient,
      context: IdentityExecutionContext,
    ) => Promise<StoredResponse>,
    targetId?: string,
  ): Promise<unknown> {
    const response = await runWholeCommandWithRetry(async () => {
      const client = await this.database.requirePool().connect();
      let transactionOpen = false;
      try {
        await client.query("begin");
        transactionOpen = true;
        const fresh = await this.identity.revalidatePatientOperation(
          client,
          context,
          permissions,
        );
        let replay;
        try {
          replay = await beginPostingIdempotency(client, {
            commandName,
            idempotencyKey,
            pharmacyId: fresh.pharmacyId,
            requestHash,
          });
        } catch (error) {
          if (!(error instanceof PostingIdempotencyConflict)) throw error;
          const requestId = await this.auditMutation(
            client,
            fresh,
            idempotencyKey,
            commandName,
            targetId,
            undefined,
            undefined,
            "idempotency-conflict",
          );
          await client.query("commit");
          transactionOpen = false;
          return {
            status: 409,
            body: {
              status: "denied",
              code: "idempotency-conflict",
              requestId,
            },
          } satisfies StoredResponse;
        }
        if (replay !== undefined) {
          if (replay.responseStatus === successStatus) {
            const storedProfile = patientProfileResponseSchema.parse(
              replay.responseBody,
            );
            const publicProfile = patientProfileResponseSchema.parse(
              profileProjection(storedProfile, fresh),
            );
            await this.auditMutation(
              client,
              fresh,
              idempotencyKey,
              "patients.profile.replay",
              publicProfile.id,
              undefined,
              {
                commandName,
                fields: [...requestFields],
                notesIncluded: mayViewNotes(fresh),
              },
              "allowed",
            );
            await client.query("commit");
            transactionOpen = false;
            return {
              status: replay.responseStatus,
              body: publicProfile,
            } satisfies StoredResponse;
          }
          await client.query("commit");
          transactionOpen = false;
          return {
            status: replay.responseStatus,
            body: replay.responseBody,
          } satisfies StoredResponse;
        }

        const result = await work(client, fresh);
        const responseBody =
          result.status === successStatus
            ? patientProfileResponseSchema.parse(result.body)
            : result.body;
        await recordPostingResult(client, {
          actorUserId: fresh.actorId,
          commandName,
          device: fresh,
          idempotencyKey,
          identitySessionId: fresh.sessionId,
          pharmacyId: fresh.pharmacyId,
          requestHash,
          responseBody,
          responseStatus: result.status,
        });
        await client.query("commit");
        transactionOpen = false;
        return { ...result, body: responseBody };
      } catch (error) {
        if (transactionOpen) {
          await client.query("rollback").catch(() => undefined);
        }
        throw error;
      } finally {
        client.release();
      }
    });
    if (response.status !== successStatus) {
      throw new PatientCommandError(
        response.status === 400 ||
          response.status === 404 ||
          response.status === 409
          ? response.status
          : 409,
        response.body,
      );
    }
    return response.body;
  }

  private async auditRead(
    client: PoolClient,
    context: IdentityExecutionContext,
    action: string,
    targetId: string | undefined,
    afterState: JsonObject,
  ): Promise<void> {
    await writePostingAudit(client, {
      action,
      actorUserId: context.actorId,
      afterState,
      device: context,
      identitySessionId: context.sessionId,
      outcome: "allowed",
      pharmacyId: context.pharmacyId,
      ...(targetId === undefined ? {} : { targetId }),
    });
  }

  private async auditMutation(
    client: PoolClient,
    context: IdentityExecutionContext,
    correlationId: string,
    action: string,
    targetId: string | undefined,
    beforeState: JsonObject | undefined,
    afterState: JsonObject | undefined,
    outcome = "committed",
  ): Promise<string> {
    return await writePostingAudit(client, {
      action,
      actorUserId: context.actorId,
      ...(beforeState === undefined ? {} : { beforeState }),
      ...(afterState === undefined ? {} : { afterState }),
      correlationId,
      device: context,
      identitySessionId: context.sessionId,
      outcome,
      pharmacyId: context.pharmacyId,
      ...(targetId === undefined ? {} : { targetId }),
    });
  }
}
