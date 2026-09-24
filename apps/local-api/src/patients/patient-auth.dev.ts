import { Injectable } from "@nestjs/common";
import type {
  ActorContext,
  AuthorizationResult,
  PatientAuthorizationPort,
  PatientPermission,
} from "./patient-auth.port.js";

// TEMPORARY: Replace with real auth when user/permission system ships. See #XX.
// This adapter grants all patient permissions to any verified device.
// It is wired ONLY in PatientsModule, never imported by the service or tests.
@Injectable()
export class DevPatientAuthorization implements PatientAuthorizationPort {
  public check(
    actorContext: ActorContext,
    permission: PatientPermission,
  ): AuthorizationResult {
    void permission;
    // Placeholder: use device ID as user ID or actual userId if present
    const actorUserId =
      actorContext.userId ??
      actorContext.deviceId ??
      "00000000-0000-0000-0000-000000000000";
    return {
      allowed: true,
      actorUserId,
    };
  }
}

@Injectable()
export class DenyAllPatientAuthorization implements PatientAuthorizationPort {
  public check(
    actorContext: ActorContext,
    permission: PatientPermission,
  ): AuthorizationResult {
    void actorContext;
    void permission;
    return {
      allowed: false,
      reason: "Authorization provider unconfigured",
    };
  }
}
