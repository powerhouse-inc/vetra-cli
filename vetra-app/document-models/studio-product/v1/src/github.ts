import type { Change } from "../gen/schema/types.js";

/**
 * The request of the change that brings in changes made on GitHub (D15): the
 * page starts it with this exact text (kind CHANGE); the agent recognises it,
 * fetches the repository's `main` and merges it into the change. Such a
 * change is never launched by itself.
 */
export const BRING_IN_REQUEST = "Bring in the changes made on GitHub";

/** Whether `change` is the one that brings in changes made on GitHub. */
export function isBringIn(change: Pick<Change, "kind" | "request">): boolean {
  return change.kind === "CHANGE" && change.request.trim() === BRING_IN_REQUEST;
}
