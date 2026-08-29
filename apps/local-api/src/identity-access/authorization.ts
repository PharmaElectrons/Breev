export const PERMISSION_NAMES = [
  "attendance.record",
  "devices.pair",
  "draft.price.override",
  "identity.roles.manage",
  "identity.users.manage",
  "licensing.manage",
  "pharmacy.settings.manage",
  "pricing.below_cost",
  "sales.invoice.reverse",
  "sales.return.post",
  "sync.conflict.resolve",
] as const;

export type PermissionName = (typeof PERMISSION_NAMES)[number];

export const STEP_UP_ACTIONS = {
  "devices.pairing.start": "devices.pair",
  "devices.revoke": "devices.pair",
  "devices.seat.release.request": "devices.pair",
  "identity.role.permissions.update": "identity.roles.manage",
  "identity.user.create": "identity.users.manage",
  "identity.user.update": "identity.users.manage",
  "licensing.licence.deactivate": "licensing.manage",
  "licensing.licence.install": "licensing.manage",
} as const satisfies Readonly<Record<string, PermissionName>>;

export type StepUpAction = keyof typeof STEP_UP_ACTIONS;

export type StepUpApprovalDecision =
  | "approved"
  | "step-up-context-mismatch"
  | "step-up-expired"
  | "step-up-missing-permission"
  | "step-up-reused"
  | "step-up-stale";

interface StepUpChallengeState {
  readonly action: StepUpAction;
  readonly actorId: string;
  readonly authRevision: bigint;
  readonly deviceId: string;
  readonly expiresAt: Date;
  readonly pharmacyIdentityRevision: bigint;
  readonly requiredPermission: PermissionName;
  readonly resolved: boolean;
  readonly roleRevision: bigint;
  readonly sessionId: string;
  readonly subjectRevision: bigint;
}

interface StepUpExecutionContext {
  readonly actorId: string;
  readonly authRevision: bigint;
  readonly deviceId: string;
  readonly permissions: readonly PermissionName[];
  readonly pharmacyIdentityRevision: bigint;
  readonly roleRevision: bigint;
  readonly sessionId: string;
}

export interface StepUpApprovalInput {
  readonly challenge: StepUpChallengeState;
  readonly context: StepUpExecutionContext;
  readonly currentSubjectRevision: bigint;
  readonly now: Date;
}

export function hasPermission(
  grants: readonly PermissionName[],
  requiredPermission: PermissionName,
): boolean {
  return grants.includes(requiredPermission);
}

export function evaluateStepUpApproval({
  challenge,
  context,
  currentSubjectRevision,
  now,
}: StepUpApprovalInput): StepUpApprovalDecision {
  if (
    context.actorId !== challenge.actorId ||
    context.deviceId !== challenge.deviceId ||
    context.sessionId !== challenge.sessionId
  ) {
    return "step-up-context-mismatch";
  }
  if (challenge.resolved) {
    return "step-up-reused";
  }
  if (now.getTime() >= challenge.expiresAt.getTime()) {
    return "step-up-expired";
  }
  if (!hasPermission(context.permissions, challenge.requiredPermission)) {
    return "step-up-missing-permission";
  }
  if (
    context.authRevision !== challenge.authRevision ||
    context.roleRevision !== challenge.roleRevision ||
    context.pharmacyIdentityRevision !== challenge.pharmacyIdentityRevision ||
    currentSubjectRevision !== challenge.subjectRevision
  ) {
    return "step-up-stale";
  }
  return "approved";
}

export function isPermissionName(value: string): value is PermissionName {
  return (PERMISSION_NAMES as readonly string[]).includes(value);
}

export function isStepUpAction(value: string): value is StepUpAction {
  return Object.hasOwn(STEP_UP_ACTIONS, value);
}
