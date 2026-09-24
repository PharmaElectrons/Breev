export interface ProfileFieldChange {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface ProfileAuditChanges {
  readonly fields: readonly ProfileFieldChange[];
  readonly [key: string]: unknown;
}

export interface NotesAuditChanges {
  readonly fields: readonly string[];
  readonly [key: string]: unknown;
}

export interface DeniedAuditChanges {
  readonly requiredPermission: string;
  readonly [key: string]: unknown;
}

function areEqualValues(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return false;
}

export function buildProfileChangeAudit(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ProfileAuditChanges {
  const fields: ProfileFieldChange[] = [];
  const candidateKeys = new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ]);

  const ignoredKeys = new Set(["id", "createdAt", "updatedAt"]);

  for (const key of candidateKeys) {
    if (ignoredKeys.has(key)) continue;
    const beforeVal = before[key];
    const afterVal = after[key];

    if (!areEqualValues(beforeVal, afterVal)) {
      fields.push({
        field: key,
        before: beforeVal,
        after: afterVal,
      });
    }
  }

  return { fields };
}

export function buildNotesChangeAudit(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): NotesAuditChanges {
  const notesKeys = ["allergies", "smoking", "sensitivities", "otherNotes"];
  const changedFields: string[] = [];

  for (const key of notesKeys) {
    const beforeVal = before[key];
    const afterVal = after[key];

    if (!areEqualValues(beforeVal, afterVal)) {
      changedFields.push(key);
    }
  }

  return { fields: changedFields };
}

export function buildDeniedAudit(
  requiredPermission: string,
): DeniedAuditChanges {
  return { requiredPermission };
}
