/** Environment lifecycle status helpers for the Deploy section.
 *
 * Mirrors the `vetra-cloud-environment` document model's status enum. The
 * model spells the failure state `DEPLOYMENt_FAILED` (lowercase `t`); match
 * that literal exactly. */

export const ENV_STATUS = {
  DRAFT: "DRAFT",
  CHANGES_PENDING: "CHANGES_PENDING",
  CHANGES_APPROVED: "CHANGES_APPROVED",
  CHANGES_PUSHED: "CHANGES_PUSHED",
  DEPLOYING: "DEPLOYING",
  DEPLOYMENT_FAILED: "DEPLOYMENt_FAILED",
  READY: "READY",
  TERMINATING: "TERMINATING",
  DESTROYED: "DESTROYED",
  ARCHIVED: "ARCHIVED",
  STOPPED: "STOPPED",
} as const;

/** Approved changes the cloud is actively rolling out — the row shows
 * "Deploying…". CHANGES_PENDING is deliberately excluded: pending changes are
 * staged but not approved, so they never roll out on their own. */
export const IN_FLIGHT = new Set<string>([
  ENV_STATUS.CHANGES_APPROVED,
  ENV_STATUS.CHANGES_PUSHED,
  ENV_STATUS.DEPLOYING,
  ENV_STATUS.TERMINATING,
]);

/** Terminal states that mean the environment is not running the change. */
const FAILED = new Set<string>([
  ENV_STATUS.DEPLOYMENT_FAILED,
  ENV_STATUS.DESTROYED,
  ENV_STATUS.STOPPED,
]);

/** Changes are staged but not yet approved; the cloud won't deploy them until
 * an approve lands. */
export function isPendingApproval(status: string): boolean {
  return status === ENV_STATUS.CHANGES_PENDING;
}

/** Environment is live on its latest approved changes. */
export function isLive(status: string): boolean {
  return status === ENV_STATUS.READY;
}

/** A terminal state where the rollout did not go live. */
export function isFailedStatus(status: string): boolean {
  return FAILED.has(status);
}

/** States from which APPROVE_CHANGES is valid (matches the model reducer's
 * precondition); calling it elsewhere throws. */
export function canApprove(status: string): boolean {
  return status === ENV_STATUS.CHANGES_PENDING || status === ENV_STATUS.DRAFT;
}
