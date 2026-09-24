import {
  createPatientRequestSchema,
  updatePatientRequestSchema,
  updatePatientNotesRequestSchema,
  addPatientWeightRequestSchema,
} from "@breev/contracts/local-rest";

export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

export function normalizeSearchQuery(
  query: string | undefined | null,
): string | null {
  if (typeof query !== "string") return null;
  const collapsed = query.trim().replace(/\s+/g, " ");
  return collapsed.length > 0 ? collapsed : null;
}

export function validatePatientCreate(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof data !== "object" || data === null) {
    return [{ field: "root", message: "Request body must be an object" }];
  }

  const record = data as Record<string, unknown>;

  if (
    typeof record.firstName !== "string" ||
    record.firstName.trim().length === 0
  ) {
    errors.push({
      field: "firstName",
      message: "First name is required and cannot be empty",
    });
  }

  if (
    typeof record.lastName !== "string" ||
    record.lastName.trim().length === 0
  ) {
    errors.push({
      field: "lastName",
      message: "Last name is required and cannot be empty",
    });
  }

  const parsed = createPatientRequestSchema.safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".") || "root";
      if (!errors.some((e) => e.field === field)) {
        errors.push({ field, message: issue.message });
      }
    }
  }

  return errors;
}

export function validatePatientUpdate(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof data !== "object" || data === null) {
    return [{ field: "root", message: "Request body must be an object" }];
  }

  const record = data as Record<string, unknown>;

  if ("firstName" in record && record.firstName !== undefined) {
    if (
      typeof record.firstName !== "string" ||
      record.firstName.trim().length === 0
    ) {
      errors.push({
        field: "firstName",
        message: "First name cannot be empty",
      });
    }
  }

  if ("lastName" in record && record.lastName !== undefined) {
    if (
      typeof record.lastName !== "string" ||
      record.lastName.trim().length === 0
    ) {
      errors.push({
        field: "lastName",
        message: "Last name cannot be empty",
      });
    }
  }

  const parsed = updatePatientRequestSchema.safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".") || "root";
      if (!errors.some((e) => e.field === field)) {
        errors.push({ field, message: issue.message });
      }
    }
  }

  return errors;
}

export function validatePatientNotes(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const parsed = updatePatientNotesRequestSchema.safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".") || "root";
      errors.push({ field, message: issue.message });
    }
  }
  return errors;
}

export function validateWeightMeasurement(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const parsed = addPatientWeightRequestSchema.safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".") || "root";
      errors.push({ field, message: issue.message });
    }
  }
  return errors;
}
