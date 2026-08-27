import {
  FREE_CORE_CAPABILITY_NAMES,
  type CapabilityName,
  type EntitlementContext as ContractEntitlementContext,
} from "@breev/contracts/local-rest";
import {
  PAID_CAPABILITIES,
  type OfflineLicenceVerification,
  type PaidCapability,
} from "./offline-licence.js";

export const FREE_CORE_CAPABILITIES = FREE_CORE_CAPABILITY_NAMES;

export type FreeCoreCapability = (typeof FREE_CORE_CAPABILITIES)[number];
export type Capability = CapabilityName;

export type StoredLicenceVerification =
  OfflineLicenceVerification | { readonly status: "missing" };

export type EntitlementContext = ContractEntitlementContext;

export function deriveEntitlement(input: {
  readonly licence: StoredLicenceVerification;
  readonly clockRollbackDetected: boolean;
}): EntitlementContext {
  if (input.clockRollbackDetected) {
    return freeCore("clock-rollback");
  }
  if (input.licence.status === "missing") {
    return freeCore("free-core");
  }
  if (input.licence.status === "invalid") {
    return freeCore(
      input.licence.reason === "expired" ? "expired" : "invalid-licence",
    );
  }

  const granted = new Set<PaidCapability>([
    ...input.licence.claims.features,
    ...input.licence.claims.founderOverrideGrants,
  ]);
  const paid = PAID_CAPABILITIES.filter((capability) =>
    granted.has(capability),
  );
  return {
    status: "licensed",
    capabilities: [...FREE_CORE_CAPABILITIES, ...paid],
    licence: {
      ...input.licence.claims,
      features: [...input.licence.claims.features],
      founderOverrideGrants: [...input.licence.claims.founderOverrideGrants],
    },
  };
}

export type CapabilityAuthorization =
  "allowed" | "permission-denied" | "entitlement-denied";

export function authorizeCapability(input: {
  readonly hasPermission: boolean;
  readonly hasEntitlement: boolean;
}): CapabilityAuthorization {
  if (!input.hasPermission) return "permission-denied";
  if (!input.hasEntitlement) return "entitlement-denied";
  return "allowed";
}

function freeCore(
  status: Exclude<EntitlementContext["status"], "licensed">,
): EntitlementContext {
  return { status, capabilities: [...FREE_CORE_CAPABILITIES], licence: null };
}
