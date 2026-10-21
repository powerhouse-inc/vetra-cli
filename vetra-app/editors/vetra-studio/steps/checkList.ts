/**
 * The Tests step's checks list (spec §5.2): the latest recorded result per
 * check kind in a change, each with a one-line plain reason. Pure.
 */
import type { Change, CheckKind } from "document-models/studio-product";

export const CHECK_LABELS: Record<CheckKind, string> = {
  GENERATE: "Code generated from the data models",
  TYPECHECK: "Type check",
  LINT: "Lint",
  REDUCER_TESTS: "Reducer tests",
  SMOKE: "Preview renders without errors",
};

const CHECK_ORDER: readonly CheckKind[] = [
  "GENERATE",
  "TYPECHECK",
  "LINT",
  "REDUCER_TESTS",
  "SMOKE",
];

export type CheckStatus = "passed" | "failed" | "waived" | "not-run";

export interface CheckLine {
  kind: CheckKind;
  label: string;
  status: CheckStatus;
  /** The recorded plain reason (failures), null when there is none. */
  reason: string | null;
  at: string | null;
}

/** The latest result per kind; a later-recorded run wins a tie. */
export function checkList(change: Change | null): CheckLine[] {
  return CHECK_ORDER.map((kind) => {
    let latest: { at: string; passed: boolean; reason: string | null } | null =
      null;
    for (const run of change?.checkRuns ?? []) {
      const result = run.results.find((r) => r.kind === kind);
      if (result && (!latest || Date.parse(run.at) >= Date.parse(latest.at))) {
        latest = {
          at: run.at,
          passed: result.passed,
          reason: result.reason ?? null,
        };
      }
    }
    if (!latest) {
      return {
        kind,
        label: CHECK_LABELS[kind],
        status: "not-run",
        reason: null,
        at: null,
      };
    }
    const waived =
      !latest.passed &&
      kind === "LINT" &&
      !!change?.lintWaivedAt &&
      Date.parse(change.lintWaivedAt) >= Date.parse(latest.at);
    return {
      kind,
      label: CHECK_LABELS[kind],
      status: latest.passed ? "passed" : waived ? "waived" : "failed",
      reason: latest.reason,
      at: latest.at,
    };
  });
}
