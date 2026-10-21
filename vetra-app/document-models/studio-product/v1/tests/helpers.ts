import type {
  Change,
  CheckKind,
  CheckResultInput,
  StudioProductAction,
  StudioProductDocument,
  StudioProductState,
} from "document-models/studio-product/v1";
import {
  initProduct,
  planSteps,
  recordCheckRun,
  reducer,
  startChange,
  utils,
} from "document-models/studio-product/v1";

/** Deterministic timestamps: `at(5)` is 10:05 on 2026-10-20 (UTC). */
export function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 20, 10, minute)).toISOString();
}

export const CHECK_KINDS: CheckKind[] = [
  "GENERATE",
  "TYPECHECK",
  "LINT",
  "REDUCER_TESTS",
  "SMOKE",
];

export function apply(
  doc: StudioProductDocument,
  ...actions: StudioProductAction[]
): StudioProductDocument {
  return actions.reduce((d, a) => reducer(d, a), doc);
}

/** Error of the operation at `index` (null when it succeeded). */
export function errorAt(doc: StudioProductDocument, index: number): unknown {
  return doc.operations.global[index].error ?? null;
}

/** Error of the most recently dispatched operation. */
export function lastError(doc: StudioProductDocument): unknown {
  return errorAt(doc, doc.operations.global.length - 1);
}

export function change(doc: StudioProductDocument, id = "c1"): Change {
  const found = doc.state.global.changes.find((c) => c.id === id);
  if (!found) throw new Error(`change ${id} missing in test`);
  return found;
}

export function step(
  doc: StudioProductDocument,
  kind: string,
  changeId = "c1",
): Change["steps"][number] {
  const found = change(doc, changeId).steps.find((s) => s.kind === kind);
  if (!found) throw new Error(`step ${kind} missing in test`);
  return found;
}

export function results(
  passed: Partial<Record<CheckKind, boolean>>,
): CheckResultInput[] {
  return CHECK_KINDS.filter((k) => k in passed).map((kind) => ({
    kind,
    passed: passed[kind] ?? false,
  }));
}

export function run(
  id: string,
  minute: number,
  passed: Partial<Record<CheckKind, boolean>>,
  changeId = "c1",
): StudioProductAction {
  return recordCheckRun({
    changeId,
    id,
    at: at(minute),
    results: results(passed),
  });
}

export function allPassing(
  id: string,
  minute: number,
  changeId = "c1",
): StudioProductAction {
  return run(
    id,
    minute,
    {
      GENERATE: true,
      TYPECHECK: true,
      LINT: true,
      REDUCER_TESTS: true,
      SMOKE: true,
    },
    changeId,
  );
}

/** Initialised product with change `c1` (FIRST_BUILD) planned with all five steps. */
export function building(
  kind: "FIRST_BUILD" | "CHANGE" | "UNDO" = "FIRST_BUILD",
): StudioProductDocument {
  return apply(
    utils.createDocument(),
    initProduct({
      name: "Dog walks",
      idea: "an app to plan dog walks",
      createdAt: at(0),
    }),
    startChange({
      id: "c1",
      kind,
      request: "an app to plan dog walks",
      chatSessionId: "phd:session-1",
      startedAt: at(1),
    }),
    planSteps({
      changeId: "c1",
      steps: [
        { kind: "PLAN" },
        { kind: "DATA", total: 3 },
        { kind: "EDITORS", total: 2 },
        { kind: "TESTS" },
        { kind: "LIVE" },
      ],
    }),
  );
}

/** A change in a given status, built directly into the state (for statuses later tasks reach). */
export function craftedChange(
  id: string,
  status: Change["status"],
  extra: Partial<Change> = {},
): Change {
  return {
    id,
    kind: "CHANGE",
    request: `request ${id}`,
    title: null,
    chatSessionId: null,
    chatSessionIds: [],
    status,
    startedAt: at(0),
    steps: [
      {
        kind: "TESTS",
        status: "NOT_STARTED",
        done: null,
        total: null,
        label: null,
        reason: null,
        updatedAt: null,
      },
    ],
    milestones: [],
    checkRuns: [],
    stuck: null,
    metrics: {
      steps: 0,
      firstPreviewAt: null,
      readyAt: null,
      liveAt: null,
    },
    lintWaivedAt: null,
    ...extra,
  };
}

export function withState(
  global: Partial<StudioProductState>,
): StudioProductDocument {
  const initial = utils.createDocument().state.global;
  return utils.createDocument({ global: { ...initial, ...global } });
}
