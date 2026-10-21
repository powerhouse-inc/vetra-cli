import type { StudioProductChangeOperations } from "document-models/studio-product/v1";
import {
  AdoptNotAllowedError,
  ChangeInProgressError,
  ChangeNotFoundError,
  DuplicateChangeIdError,
  DuplicateCheckKindError,
  DuplicateCheckRunIdError,
  DuplicateMilestoneIdError,
  DuplicateStepKindError,
  GateNotMetError,
  InvalidAttentionStatusError,
  InvalidChangeKindError,
  InvalidChangeStatusError,
  InvalidCountError,
  LiveBeforeVersionsNotAllowedError,
  NothingToWaiveError,
  OutcomeTooLongError,
  StepNotDoneError,
  StepNotPlannedError,
} from "../../gen/change/error.js";
import type {
  Change,
  ChangeStatus,
  CheckKind,
  CheckResult,
  CheckRun,
  ProductStep,
  StepKind,
  StudioProductState,
} from "../../gen/schema/types.js";
import { normalizeProduct } from "../normalize.js";

const STEP_ORDER: StepKind[] = ["PLAN", "DATA", "EDITORS", "TESTS", "LIVE"];
const CHECK_KINDS: CheckKind[] = [
  "GENERATE",
  "TYPECHECK",
  "LINT",
  "REDUCER_TESTS",
  "SMOKE",
];
const STEP_LABELS: Record<StepKind, string> = {
  PLAN: "Plan",
  DATA: "Data",
  EDITORS: "Editors",
  TESTS: "Tests",
  LIVE: "Live",
};

/** An Outcome line is one customer-facing sentence. */
const OUTCOME_MAX = 120;

/** Statuses that count as "in progress" (D13); CLOSED never does. */
const IN_PROGRESS: ChangeStatus[] = [
  "BUILDING",
  "PAUSED",
  "READY",
  "LAUNCHING",
];

function findChange(state: StudioProductState, changeId: string): Change {
  normalizeProduct(state);
  const change = state.changes.find((c) => c.id === changeId);
  if (!change) {
    throw new ChangeNotFoundError(`No change "${changeId}" exists.`);
  }
  return change;
}

/** A change that can still be worked on. */
function openChange(state: StudioProductState, changeId: string): Change {
  const change = findChange(state, changeId);
  if (!IN_PROGRESS.includes(change.status)) {
    throw new InvalidChangeStatusError(
      `Change "${changeId}" is ${change.status} and can no longer be worked on.`,
    );
  }
  return change;
}

/**
 * While a launch owns the change (LAUNCHING), START/COMPLETE/FAIL_LAUNCH are
 * the only writers of its LIVE line; the agent's edits would race them. The
 * status is checked separately because SET_CHANGE_TITLE is also allowed on a
 * closed change.
 */
function assertNotLaunching(change: Change): void {
  if (change.status === "LAUNCHING") {
    throw new InvalidChangeStatusError(
      `Change "${change.id}" is going live and can't be edited until the launch ends.`,
    );
  }
}

/** A change that can still be worked on and isn't going live. */
function editableChange(state: StudioProductState, changeId: string): Change {
  const change = openChange(state, changeId);
  assertNotLaunching(change);
  return change;
}

/** Changes that can still be thrown away (a launch in flight cannot). */
const DISCARDABLE: ChangeStatus[] = ["BUILDING", "PAUSED", "READY"];

function findStep(change: Change, kind: StepKind): ProductStep {
  const step = change.steps.find((s) => s.kind === kind);
  if (!step) {
    throw new StepNotPlannedError(
      `Step ${kind} is not planned in change "${change.id}".`,
    );
  }
  return step;
}

function newStep(kind: StepKind, total: number | null): ProductStep {
  return {
    kind,
    status: "NOT_STARTED",
    done: null,
    total,
    label: null,
    reason: null,
    updatedAt: null,
  };
}

function assertCount(done: number | null, total: number | null): void {
  if (
    (done !== null && done < 0) ||
    (total !== null && total < 0) ||
    (done !== null && total !== null && done > total)
  ) {
    throw new InvalidCountError(
      `Invalid count: done ${String(done)}, total ${String(total)}.`,
    );
  }
}

/**
 * BUILDING ↔ READY: a FIRST_BUILD, CHANGE or UNDO change is READY exactly
 * when it has planned steps besides LIVE and all of them are DONE. PAUSED,
 * LAUNCHING and closed changes are left alone (BEFORE_VERSIONS changes are
 * always CLOSED, so they never get here).
 */
function syncReadiness(change: Change): void {
  const work = change.steps.filter((s) => s.kind !== "LIVE");
  const allDone = work.length > 0 && work.every((s) => s.status === "DONE");
  if (change.status === "BUILDING" && allDone) change.status = "READY";
  else if (change.status === "READY" && !allDone) change.status = "BUILDING";
}

function time(iso: string): number {
  return Date.parse(iso);
}

/** The latest run (by time; later-recorded wins a tie) holding a result of `kind`. */
function latestRunWith(
  change: Change,
  kind: CheckKind,
): { run: CheckRun; result: CheckResult } | null {
  let best: { run: CheckRun; result: CheckResult } | null = null;
  for (const run of change.checkRuns) {
    const result = run.results.find((r) => r.kind === kind);
    if (result && (!best || time(run.at) >= time(best.run.at))) {
      best = { run, result };
    }
  }
  return best;
}

/** Kinds whose latest result in this change failed (ignoring any waiver). */
function failingKinds(change: Change): CheckKind[] {
  return CHECK_KINDS.filter(
    (kind) => latestRunWith(change, kind)?.result.passed === false,
  );
}

function lintWaived(change: Change, lintRunAt: string): boolean {
  return !!change.lintWaivedAt && time(change.lintWaivedAt) >= time(lintRunAt);
}

/** Returns why the step's gate is not met, or null when it is (LIVE: see liveProblem). */
function gateProblem(change: Change, kind: StepKind): string | null {
  const required: CheckKind[] =
    kind === "DATA"
      ? ["GENERATE"]
      : kind === "EDITORS"
        ? ["SMOKE"]
        : kind === "TESTS"
          ? CHECK_KINDS
          : [];
  let generatedAt = -Infinity;
  for (const check of required) {
    const latest = latestRunWith(change, check);
    if (!latest) return `no ${check} result in this change`;
    const runAt = time(latest.run.at);
    if (
      !latest.result.passed &&
      !(check === "LINT" && lintWaived(change, latest.run.at))
    ) {
      return `the latest ${check} did not pass`;
    }
    if (check === "GENERATE") generatedAt = runAt;
    // TESTS: the latest TYPECHECK and SMOKE must not predate the latest GENERATE.
    if (
      kind === "TESTS" &&
      (check === "TYPECHECK" || check === "SMOKE") &&
      runAt < generatedAt
    ) {
      return `the latest ${check} is older than GENERATE`;
    }
  }
  return null;
}

/** LIVE is done only once the live version is this change's launch. */
function liveProblem(state: StudioProductState, change: Change): string | null {
  const live = state.versions.find((v) => v.number === state.liveVersion);
  return live?.changeId === change.id ? null : "the change has not gone live";
}

export const studioProductChangeOperations: StudioProductChangeOperations = {
  startChangeOperation(state, action) {
    normalizeProduct(state);
    const { id, kind } = action.input;
    if (kind === "BEFORE_VERSIONS") {
      throw new InvalidChangeKindError(
        "BEFORE_VERSIONS changes are created only by ADOPT_EXISTING.",
      );
    }
    if (state.changes.some((c) => c.id === id)) {
      throw new DuplicateChangeIdError(`A change "${id}" already exists.`);
    }
    const busy = state.changes.find((c) => IN_PROGRESS.includes(c.status));
    if (busy) {
      throw new ChangeInProgressError(
        `Change "${busy.id}" is still in progress (${busy.status}).`,
      );
    }
    const chatSessionId = action.input.chatSessionId ?? null;
    state.changes.push({
      id,
      kind,
      request: action.input.request,
      title: null,
      chatSessionId,
      chatSessionIds: chatSessionId ? [chatSessionId] : [],
      status: "BUILDING",
      startedAt: action.input.startedAt,
      steps: [],
      milestones: [],
      checkRuns: [],
      stuck: null,
      metrics: { steps: 0, firstPreviewAt: null, readyAt: null, liveAt: null },
      lintWaivedAt: null,
      variants: [],
      questions: [],
      cost: null,
    });
    state.activeChangeId = id;
  },

  adoptExistingOperation(state, action) {
    normalizeProduct(state);
    if (state.changes.length > 0) {
      throw new AdoptNotAllowedError(
        "The product already has changes; only a product without changes can adopt existing work.",
      );
    }
    const { changeId, chatSessionIds, doneSteps, at } = action.input;
    // Gate-exempt by design: this records work done before check runs existed.
    state.changes.push({
      id: changeId,
      kind: "BEFORE_VERSIONS",
      request: action.input.request,
      title: null,
      chatSessionId: chatSessionIds.length > 0 ? chatSessionIds[0] : null,
      chatSessionIds: [...chatSessionIds],
      status: "CLOSED",
      startedAt: at,
      steps: STEP_ORDER.map((kind) =>
        doneSteps.includes(kind)
          ? { ...newStep(kind, null), status: "DONE", updatedAt: at }
          : newStep(kind, null),
      ),
      milestones: [],
      checkRuns: [],
      stuck: null,
      metrics: { steps: 0, firstPreviewAt: null, readyAt: null, liveAt: null },
      lintWaivedAt: null,
      variants: [],
      questions: [],
      cost: null,
    });
  },

  planStepsOperation(state, action) {
    const change = editableChange(state, action.input.changeId);
    const seen = new Set<StepKind>();
    const steps = action.input.steps.map(({ kind, total }) => {
      if (seen.has(kind)) {
        throw new DuplicateStepKindError(
          `Step ${kind} is listed more than once.`,
        );
      }
      seen.add(kind);
      const existing = change.steps.find((s) => s.kind === kind);
      const newTotal = total ?? existing?.total ?? null;
      assertCount(existing?.done ?? null, newTotal);
      return existing
        ? { ...existing, total: newTotal }
        : newStep(kind, newTotal);
    });
    change.steps = steps;
    syncReadiness(change);
  },

  startStepOperation(state, action) {
    const change = editableChange(state, action.input.changeId);
    const step = findStep(change, action.input.kind);
    step.status = "WORKING";
    step.label = action.input.label ?? step.label;
    step.reason = null;
    step.updatedAt = action.input.at;
    syncReadiness(change);
  },

  countStepOperation(state, action) {
    const change = editableChange(state, action.input.changeId);
    const step = findStep(change, action.input.kind);
    assertCount(action.input.done, action.input.total);
    step.done = action.input.done;
    step.total = action.input.total;
  },

  completeStepOperation(state, action) {
    const change = editableChange(state, action.input.changeId);
    const step = findStep(change, action.input.kind);
    const problem =
      step.kind === "LIVE"
        ? liveProblem(state, change)
        : gateProblem(change, step.kind);
    if (problem) {
      throw new GateNotMetError(
        `${STEP_LABELS[step.kind]} can't be done: ${problem}.`,
      );
    }
    step.status = "DONE";
    step.reason = null;
    step.updatedAt = action.input.at;
    if (step.total !== null) step.done = step.total;
    change.stuck = null;
    syncReadiness(change);
  },

  reopenStepOperation(state, action) {
    const change = editableChange(state, action.input.changeId);
    const step = findStep(change, action.input.kind);
    if (step.status !== "DONE") {
      throw new StepNotDoneError(
        `Only a DONE step can be reopened; ${step.kind} is ${step.status}.`,
      );
    }
    step.status = "WORKING";
    step.reason = action.input.reason;
    step.updatedAt = action.input.at;
    syncReadiness(change);
  },

  addMilestoneOperation(state, action) {
    const change = openChange(state, action.input.changeId);
    const { id } = action.input;
    if (change.milestones.some((m) => m.id === id)) {
      throw new DuplicateMilestoneIdError(
        `A milestone "${id}" already exists.`,
      );
    }
    const outcome = action.input.outcome?.trim() || null;
    if (outcome && outcome.length > OUTCOME_MAX) {
      throw new OutcomeTooLongError(
        `An outcome is at most ${OUTCOME_MAX} characters, not ${outcome.length}.`,
      );
    }
    change.milestones.push({
      id,
      text: action.input.text,
      at: action.input.at,
      recovered: action.input.recovered ?? false,
      outcome,
    });
    change.stuck = null;
  },

  recordCheckRunOperation(state, action) {
    const change = openChange(state, action.input.changeId);
    const { id } = action.input;
    if (change.checkRuns.some((r) => r.id === id)) {
      throw new DuplicateCheckRunIdError(`A check run "${id}" already exists.`);
    }
    const seen = new Set<CheckKind>();
    const results = action.input.results.map((r) => {
      if (seen.has(r.kind)) {
        throw new DuplicateCheckKindError(
          `Check ${r.kind} appears more than once in run "${id}".`,
        );
      }
      seen.add(r.kind);
      return { kind: r.kind, passed: r.passed, reason: r.reason ?? null };
    });
    change.checkRuns.push({ id, at: action.input.at, results });
  },

  markStuckOperation(state, action) {
    const change = openChange(state, action.input.changeId);
    change.stuck = {
      reason: action.input.reason,
      tried: [...action.input.tried],
      at: action.input.at,
    };
  },

  clearStuckOperation(state, action) {
    findChange(state, action.input.changeId).stuck = null;
  },

  setStepAttentionOperation(state, action) {
    const change = editableChange(state, action.input.changeId);
    const step = findStep(change, action.input.kind);
    const { status } = action.input;
    if (
      status !== "NEEDS_YOU" &&
      status !== "STOPPED" &&
      status !== "WORKING"
    ) {
      throw new InvalidAttentionStatusError(
        `Attention can only be NEEDS_YOU, STOPPED or WORKING, not ${status}.`,
      );
    }
    step.status = status;
    step.reason = action.input.reason ?? null;
    step.updatedAt = action.input.at;
    syncReadiness(change);
  },

  pauseChangeOperation(state, action) {
    const change = findChange(state, action.input.changeId);
    if (change.status !== "BUILDING") {
      throw new InvalidChangeStatusError(
        `Change "${change.id}" is ${change.status}; only a BUILDING change can be paused.`,
      );
    }
    change.status = "PAUSED";
  },

  resumeChangeOperation(state, action) {
    const change = findChange(state, action.input.changeId);
    if (change.status !== "PAUSED") {
      throw new InvalidChangeStatusError(
        `Change "${change.id}" is ${change.status}; only a PAUSED change can be resumed.`,
      );
    }
    change.status = "BUILDING";
    syncReadiness(change);
  },

  recordChangeMetricsOperation(state, action) {
    const { metrics } = findChange(state, action.input.changeId);
    metrics.steps = action.input.steps;
    metrics.firstPreviewAt =
      action.input.firstPreviewAt ?? metrics.firstPreviewAt;
    metrics.readyAt = action.input.readyAt ?? metrics.readyAt;
  },

  setChangeTitleOperation(state, action) {
    const change = findChange(state, action.input.changeId);
    assertNotLaunching(change);
    change.title = action.input.title;
  },

  waiveLintOperation(state, action) {
    const change = editableChange(state, action.input.changeId);
    const failing = failingKinds(change);
    if (failing.length !== 1 || failing[0] !== "LINT") {
      throw new NothingToWaiveError(
        `Nothing to waive: failing checks are ${failing.join(", ") || "none"}.`,
      );
    }
    change.lintWaivedAt = action.input.at;
  },

  discardChangeOperation(state, action) {
    const { changeId, at } = action.input;
    const change = findChange(state, changeId);
    if (!DISCARDABLE.includes(change.status)) {
      throw new InvalidChangeStatusError(
        `Change "${changeId}" is ${change.status} and can't be discarded.`,
      );
    }
    change.status = "DISCARDED";
    const live = change.steps.find((s) => s.kind === "LIVE");
    if (live) {
      live.status = "STOPPED";
      live.reason = null;
      live.updatedAt = at;
    }
    if (state.activeChangeId === changeId) state.activeChangeId = null;
  },
  setLiveBeforeVersionsOperation(state, action) {
    normalizeProduct(state);
    // Spec 6.6: only a product adopted from before versions, before its
    // first version, can say what was live before versions.
    const adopted = state.changes.some((c) => c.kind === "BEFORE_VERSIONS");
    if (!adopted || state.versions.length > 0) {
      throw new LiveBeforeVersionsNotAllowedError(
        "Only a product adopted from before versions, with no version yet, can record what was live before versions.",
      );
    }
    const { environmentId, url, at } = action.input;
    state.liveBeforeVersions = { environmentId, url, at };
  },
};
