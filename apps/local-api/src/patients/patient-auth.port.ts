export type PatientPermission =
  "patients.view" | "patients.create" | "patients.edit" | "patients.notes";

export type AuthorizationResult =
  | { readonly allowed: true; readonly actorUserId: string }
  | { readonly allowed: false; readonly reason: string };

export interface ActorContext {
  readonly deviceId?: string | undefined;
  readonly userId?: string | undefined;
}

export interface PatientAuthorizationPort {
  check(
    actorContext: ActorContext,
    permission: PatientPermission,
  ): AuthorizationResult;
}
