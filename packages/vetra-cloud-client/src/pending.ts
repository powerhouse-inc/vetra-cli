/**
 * Pending-change view of an environment document. The document stores no diff
 * of what a CHANGES_PENDING status is waiting on, so it is derived from the
 * operation log: the user edits applied since the last APPROVE_CHANGES.
 */

/** Statuses APPROVE_CHANGES is valid from (mirrors the reducer's guard). DRAFT
 * is the first deploy of a new environment; CHANGES_PENDING an edit to a
 * deployed one. */
export const APPROVABLE_STATUSES: readonly string[] = [
  "DRAFT",
  "CHANGES_PENDING",
];

/** True when APPROVE_CHANGES would be accepted from `status`. */
export function canApproveChanges(status: string | null | undefined): boolean {
  return !!status && APPROVABLE_STATUSES.includes(status);
}

/** Actions that drive the lifecycle or are written by the platform, not user
 * edits waiting for approval. */
const NON_EDIT_ACTIONS = new Set([
  "APPROVE_CHANGES",
  "MARK_CHANGES_PUSHED",
  "MARK_DEPLOYMENT_STARTED",
  "REPORT_DEPLOYMENT_SUCCEEDED",
  "REPORT_DEPLOYMENT_FAILED",
  "TERMINATE_ENVIRONMENT",
  "MARK_DESTROYED",
  "ARCHIVE",
  "UNARCHIVE",
  "SLEEP_ENVIRONMENT",
  "WAKE_ENVIRONMENT",
  "SET_SERVICE_STATUS",
  "SET_DNS_RECORDS",
  "SYNC_ORG_OPERATORS",
]);

/** The minimal operation shape this module reads (a subset of document-model's
 * `Operation`), so callers can pass `controller.operations.global` directly. */
export interface OperationLike {
  index?: number;
  timestampUtcMs?: string | number;
  action: { type: string; input?: unknown };
}

export interface PendingChange {
  type: string;
  input: unknown;
  timestampUtcMs?: string | number;
}

/** User edits applied after the most recent APPROVE_CHANGES, oldest first. */
export function pendingChanges(
  operations: readonly OperationLike[] | undefined,
): PendingChange[] {
  const ops = operations ?? [];
  let start = 0;
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i].action.type === "APPROVE_CHANGES") {
      start = i + 1;
      break;
    }
  }
  return ops
    .slice(start)
    .filter((op) => !NON_EDIT_ACTIONS.has(op.action.type))
    .map((op) => ({
      type: op.action.type,
      input: op.action.input,
      timestampUtcMs: op.timestampUtcMs,
    }));
}

function field(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const v = (input as Record<string, unknown>)[key];
  return v === undefined || v === null ? undefined : String(v);
}

/** One-line human description of a pending change. Known edits get a short
 * phrase; anything else falls back to the action type and its input. */
export function describePendingChange(change: PendingChange): string {
  const i = change.input;
  switch (change.type) {
    case "ADD_PACKAGE": {
      const v = field(i, "version");
      return `add package ${field(i, "packageName")}${v ? `@${v}` : ""}`;
    }
    case "REMOVE_PACKAGE":
      return `remove package ${field(i, "packageName")}`;
    case "SET_PACKAGE_VERSION":
      return `set package ${field(i, "packageName")} to ${field(i, "version")}`;
    case "ENABLE_SERVICE":
      return `enable service ${field(i, "type")}`;
    case "DISABLE_SERVICE":
      return `disable service ${field(i, "type")}`;
    case "SET_SERVICE_SIZE":
      return `set ${field(i, "prefix")} size to ${field(i, "size")}`;
    case "SET_SERVICE_VERSION":
      return `set ${field(i, "type")} version to ${field(i, "version")}`;
    case "SET_LABEL":
      return `rename to "${field(i, "label")}"`;
    default: {
      const json = i === undefined ? "" : JSON.stringify(i);
      return json && json !== "{}" ? `${change.type} ${json}` : change.type;
    }
  }
}
