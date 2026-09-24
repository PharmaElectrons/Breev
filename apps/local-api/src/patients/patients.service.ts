import { Injectable, Inject } from "@nestjs/common";
import { LocalDatabaseService } from "../local-database.service.js";
import { PatientsRepository } from "./patients.repository.js";
import type {
  PatientAuthorizationPort,
  ActorContext,
} from "./patient-auth.port.js";
import type {
  CreatePatientRequest,
  UpdatePatientRequest,
  UpdatePatientNotesRequest,
  UpdatePatientDiscountRequest,
  UpdatePatientDndRequest,
  AddPatientWeightRequest,
} from "@breev/contracts/local-rest";
import type { PoolClient } from "pg";
import {
  validatePatientCreate,
  validatePatientUpdate,
  validatePatientNotes,
  validateWeightMeasurement,
  normalizeSearchQuery,
  type ValidationError,
} from "./patient-validation.js";
import {
  parseExactWeight,
  parseExactHeight,
  parseExactDiscount,
} from "./patient-exact-decimal.js";
import {
  buildProfileChangeAudit,
  buildNotesChangeAudit,
  buildDeniedAudit,
} from "./patient-audit-builder.js";

export class PatientAuthorizationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "PatientAuthorizationError";
  }
}

export class PatientNotFoundError extends Error {
  constructor() {
    super("Patient not found");
    this.name = "PatientNotFoundError";
  }
}

export class PatientConflictError extends Error {
  constructor() {
    super("Patient conflict: Optimistic locking failed");
    this.name = "PatientConflictError";
  }
}

export class PatientValidationError extends Error {
  constructor(public readonly errors: readonly ValidationError[]) {
    super(
      `Validation failed: ${errors.map((e) => `${e.field}: ${e.message}`).join(", ")}`,
    );
    this.name = "PatientValidationError";
  }
}

function resolveActorUserId(actor: ActorContext): string {
  return (
    actor.userId ?? actor.deviceId ?? "00000000-0000-0000-0000-000000000000"
  );
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly localDatabase: LocalDatabaseService,
    private readonly repository: PatientsRepository,
    @Inject("PatientAuthorizationPort")
    private readonly authPort: PatientAuthorizationPort,
  ) {}

  private async withTransaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.localDatabase.requirePool().connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async searchPatients(
    actor: ActorContext,
    q: string | undefined,
    page: number,
    limit: number,
  ) {
    const authResult = this.authPort.check(actor, "patients.view");
    if (!authResult.allowed) {
      // Security decision: return empty list on denial instead of 403
      // Note: Search denial cannot be audited in patient_audit_events because it lacks a specific patient_id
      return { items: [], total: 0, page, limit, totalPages: 0 };
    }

    const normalizedQ = normalizeSearchQuery(q) ?? undefined;
    const offset = (page - 1) * limit;
    const result = await this.repository.searchPatients(
      normalizedQ,
      limit,
      offset,
    );
    return {
      items: result.items,
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    };
  }

  public async getPatientById(actor: ActorContext, id: string) {
    const authResult = this.authPort.check(actor, "patients.view");
    if (!authResult.allowed) {
      throw new PatientAuthorizationError(authResult.reason);
    }

    const patient = await this.repository.getPatientById(id);
    if (!patient) {
      throw new PatientNotFoundError();
    }

    // Optional fields masked if notes permission is not present
    const notesAuthResult = this.authPort.check(actor, "patients.notes");
    if (!notesAuthResult.allowed) {
      // Audit view-notes denial
      await this.withTransaction(async (client) => {
        await this.repository.insertAuditEvent(
          {
            patientId: id,
            actorUserId: resolveActorUserId(actor),
            action: "view-notes",
            outcome: "denied",
            changes: buildDeniedAudit("patients.notes"),
          },
          client,
        );
      });

      return {
        ...patient,
        allergies: undefined,
        smoking: undefined,
        sensitivities: undefined,
        otherNotes: undefined,
      };
    }

    return patient;
  }

  public async createPatient(actor: ActorContext, data: CreatePatientRequest) {
    const authResult = this.authPort.check(actor, "patients.create");
    if (!authResult.allowed) {
      throw new PatientAuthorizationError(authResult.reason);
    }

    const validationErrors = validatePatientCreate(data);
    if (validationErrors.length > 0) {
      throw new PatientValidationError(validationErrors);
    }
    if (data.heightCm) {
      parseExactHeight(data.heightCm);
    }

    return await this.withTransaction(async (client) => {
      const patient = await this.repository.createPatient(data, client);
      if (!patient) throw new PatientConflictError();
      await this.repository.insertAuditEvent(
        {
          patientId: patient.id,
          actorUserId: authResult.actorUserId,
          action: "create",
          outcome: "allowed",
          changes: { created: true },
        },
        client,
      );
      return patient;
    });
  }

  public async updatePatientProfile(
    actor: ActorContext,
    id: string,
    data: UpdatePatientRequest,
  ) {
    const authResult = this.authPort.check(actor, "patients.edit");
    if (!authResult.allowed) {
      // Audit denial
      await this.withTransaction(async (client) => {
        await this.repository.insertAuditEvent(
          {
            patientId: id,
            actorUserId: resolveActorUserId(actor),
            action: "edit-profile",
            outcome: "denied",
            changes: buildDeniedAudit("patients.edit"),
          },
          client,
        );
      });
      throw new PatientAuthorizationError(authResult.reason);
    }

    const validationErrors = validatePatientUpdate(data);
    if (validationErrors.length > 0) {
      throw new PatientValidationError(validationErrors);
    }
    if (data.heightCm) {
      parseExactHeight(data.heightCm);
    }

    return await this.withTransaction(async (client) => {
      const before = await this.repository.getPatientById(id, client);
      if (!before) {
        throw new PatientNotFoundError();
      }

      const patient = await this.repository.updatePatient(
        id,
        data,
        data.updatedAt,
        client,
      );
      if (!patient) {
        throw new PatientConflictError();
      }

      const auditChanges = buildProfileChangeAudit(
        before as unknown as Record<string, unknown>,
        patient as unknown as Record<string, unknown>,
      );

      await this.repository.insertAuditEvent(
        {
          patientId: patient.id,
          actorUserId: authResult.actorUserId,
          action: "edit-profile",
          outcome: "allowed",
          changes: auditChanges,
        },
        client,
      );

      return patient;
    });
  }

  public async updatePatientNotes(
    actor: ActorContext,
    id: string,
    data: UpdatePatientNotesRequest,
  ) {
    const authResult = this.authPort.check(actor, "patients.notes");
    if (!authResult.allowed) {
      await this.withTransaction(async (client) => {
        await this.repository.insertAuditEvent(
          {
            patientId: id,
            actorUserId: resolveActorUserId(actor),
            action: "edit-notes",
            outcome: "denied",
            changes: buildDeniedAudit("patients.notes"),
          },
          client,
        );
      });
      throw new PatientAuthorizationError(authResult.reason);
    }

    const validationErrors = validatePatientNotes(data);
    if (validationErrors.length > 0) {
      throw new PatientValidationError(validationErrors);
    }

    return await this.withTransaction(async (client) => {
      const before = await this.repository.getPatientById(id, client);
      if (!before) {
        throw new PatientNotFoundError();
      }

      const patient = await this.repository.updatePatient(
        id,
        data,
        data.updatedAt,
        client,
      );
      if (!patient) {
        throw new PatientConflictError();
      }

      const auditChanges = buildNotesChangeAudit(
        before as unknown as Record<string, unknown>,
        patient as unknown as Record<string, unknown>,
      );

      await this.repository.insertAuditEvent(
        {
          patientId: patient.id,
          actorUserId: authResult.actorUserId,
          action: "edit-notes",
          outcome: "allowed",
          changes: auditChanges,
        },
        client,
      );

      return patient;
    });
  }

  public async updatePatientDiscount(
    actor: ActorContext,
    id: string,
    data: UpdatePatientDiscountRequest,
  ) {
    const authResult = this.authPort.check(actor, "patients.edit"); // Assuming discount is part of edit permission
    if (!authResult.allowed) {
      await this.withTransaction(async (client) => {
        await this.repository.insertAuditEvent(
          {
            patientId: id,
            actorUserId: resolveActorUserId(actor),
            action: "edit-discount",
            outcome: "denied",
            changes: buildDeniedAudit("patients.edit"),
          },
          client,
        );
      });
      throw new PatientAuthorizationError(authResult.reason);
    }

    if (data.discountPercent) {
      parseExactDiscount(data.discountPercent);
    }

    return await this.withTransaction(async (client) => {
      const patient = await this.repository.updatePatient(
        id,
        data,
        data.updatedAt,
        client,
      );
      if (!patient) {
        throw new PatientConflictError();
      }

      await this.repository.insertAuditEvent(
        {
          patientId: patient.id,
          actorUserId: authResult.actorUserId,
          action: "edit-discount",
          outcome: "allowed",
          changes: { discountPercent: data.discountPercent },
        },
        client,
      );

      return patient;
    });
  }

  public async updatePatientDnd(
    actor: ActorContext,
    id: string,
    data: UpdatePatientDndRequest,
  ) {
    const authResult = this.authPort.check(actor, "patients.edit");
    if (!authResult.allowed) {
      await this.withTransaction(async (client) => {
        await this.repository.insertAuditEvent(
          {
            patientId: id,
            actorUserId: resolveActorUserId(actor),
            action: "edit-dnd",
            outcome: "denied",
            changes: buildDeniedAudit("patients.edit"),
          },
          client,
        );
      });
      throw new PatientAuthorizationError(authResult.reason);
    }

    return await this.withTransaction(async (client) => {
      const patient = await this.repository.updatePatient(
        id,
        data,
        data.updatedAt,
        client,
      );
      if (!patient) {
        throw new PatientConflictError();
      }

      await this.repository.insertAuditEvent(
        {
          patientId: patient.id,
          actorUserId: authResult.actorUserId,
          action: "edit-dnd",
          outcome: "allowed",
          changes: { doNotDisturb: data.doNotDisturb },
        },
        client,
      );

      return patient;
    });
  }

  public async addWeight(
    actor: ActorContext,
    patientId: string,
    data: AddPatientWeightRequest,
  ) {
    const authResult = this.authPort.check(actor, "patients.edit");
    if (!authResult.allowed) {
      await this.withTransaction(async (client) => {
        await this.repository.insertAuditEvent(
          {
            patientId,
            actorUserId: resolveActorUserId(actor),
            action: "add-weight",
            outcome: "denied",
            changes: buildDeniedAudit("patients.edit"),
          },
          client,
        );
      });
      throw new PatientAuthorizationError(authResult.reason);
    }

    const validationErrors = validateWeightMeasurement(data);
    if (validationErrors.length > 0) {
      throw new PatientValidationError(validationErrors);
    }
    parseExactWeight(data.weightKg);

    return await this.withTransaction(async (client) => {
      const weight = await this.repository.insertWeight(
        patientId,
        data.weightKg,
        data.measuredAt,
        authResult.actorUserId,
        client,
      );
      if (!weight) throw new PatientConflictError();

      await this.repository.insertAuditEvent(
        {
          patientId,
          actorUserId: authResult.actorUserId,
          action: "add-weight",
          outcome: "allowed",
          changes: { weightId: weight.id, weightKg: weight.weightKg },
        },
        client,
      );

      return weight;
    });
  }

  public async listWeights(
    actor: ActorContext,
    patientId: string,
    page: number,
    limit: number,
  ) {
    const authResult = this.authPort.check(actor, "patients.view");
    if (!authResult.allowed) {
      throw new PatientAuthorizationError(authResult.reason);
    }

    const offset = (page - 1) * limit;
    const result = await this.repository.listWeights(patientId, limit, offset);
    return {
      items: result.items,
      bmi: result.bmi,
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    };
  }

  public async archivePatient(
    actor: ActorContext,
    id: string,
    expectedUpdatedAt: string,
  ) {
    const authResult = this.authPort.check(actor, "patients.edit");
    if (!authResult.allowed) {
      await this.withTransaction(async (client) => {
        await this.repository.insertAuditEvent(
          {
            patientId: id,
            actorUserId: resolveActorUserId(actor),
            action: "archive",
            outcome: "denied",
          },
          client,
        );
      });
      throw new PatientAuthorizationError(authResult.reason);
    }

    return await this.withTransaction(async (client) => {
      const patient = await this.repository.archivePatient(
        id,
        expectedUpdatedAt,
        client,
      );
      if (!patient) {
        throw new PatientConflictError();
      }

      await this.repository.insertAuditEvent(
        {
          patientId: patient.id,
          actorUserId: authResult.actorUserId,
          action: "archive",
          outcome: "allowed",
          changes: { archivedAt: patient.archivedAt },
        },
        client,
      );

      return patient;
    });
  }

  public async restorePatient(
    actor: ActorContext,
    id: string,
    expectedUpdatedAt: string,
  ) {
    const authResult = this.authPort.check(actor, "patients.edit");
    if (!authResult.allowed) {
      await this.withTransaction(async (client) => {
        await this.repository.insertAuditEvent(
          {
            patientId: id,
            actorUserId: resolveActorUserId(actor),
            action: "restore",
            outcome: "denied",
          },
          client,
        );
      });
      throw new PatientAuthorizationError(authResult.reason);
    }

    return await this.withTransaction(async (client) => {
      const patient = await this.repository.restorePatient(
        id,
        expectedUpdatedAt,
        client,
      );
      if (!patient) {
        throw new PatientConflictError();
      }

      await this.repository.insertAuditEvent(
        {
          patientId: patient.id,
          actorUserId: authResult.actorUserId,
          action: "restore",
          outcome: "allowed",
          changes: { restored: true },
        },
        client,
      );

      return patient;
    });
  }
}
