/**
 * The error every launch building block throws, so the orchestrator can tell
 * what went wrong without parsing messages:
 *
 * - `code` — a stable machine code (`PERMISSION` maps to
 *   `SET_LAUNCH_PERMISSION`; cloud codes such as `STUDIO_BINDING` pass through).
 * - `reason` — the plain reason for `FAIL_LAUNCH` (F39: no sentence around it).
 * - `message` — the technical detail for logs; never carries a secret.
 */
export type LaunchErrorCode =
  | "PERMISSION"
  | "STUDIO_SECRET_PENDING"
  | "NO_STUDIO"
  | "NOTHING_TO_PUBLISH"
  | "PUBLISH_FAILED"
  | "GIT_FAILED"
  | "TAG_EXISTS"
  | "NOT_ON_MAIN"
  | "CLOUD_UNAVAILABLE"
  | (string & {});

export class LaunchError extends Error {
  readonly code: LaunchErrorCode;
  readonly reason: string;

  constructor(code: LaunchErrorCode, reason: string, detail?: string) {
    super(detail ?? reason);
    this.name = "LaunchError";
    this.code = code;
    this.reason = reason;
  }
}

/** Cloud codes that mean the owner's OK to publish is missing or expired (F7). */
const PERMISSION_CODES = new Set([
  "PERMISSION",
  "DELEGATION_EXPIRED",
  "DELEGATION_MISSING",
]);

/** True when the launch needs the owner's OK again (→ `SET_LAUNCH_PERMISSION`). */
export function isPermissionError(err: unknown): boolean {
  return err instanceof LaunchError && PERMISSION_CODES.has(err.code);
}
