/**
 * Studio-made edits as normal changes.
 *
 * Some code changes are made from the Studio page itself, with no agent turn
 * (edit text in place, keep a theme or a variant, import a remix). Each one
 * goes through `applyStudioEdit`, so it is an ordinary change like the agent's:
 *
 *   1. join the change in progress (BUILDING / READY / PAUSED), or start one
 *      (`START_CHANGE` kind CHANGE with the edit's request — no chat message,
 *      no agent turn) from the live version's code (`prepareChangeBase`), and
 *      plan + start its Tests step;
 *   2. let the edit write its files, then commit exactly those (plus what
 *      codegen regenerated) as `<milestone>` by the Studio;
 *   3. add the milestone, run the checks and record them (`RECORD_CHECK_RUN`);
 *   4. a Studio-made change (one it started, or one whose only planned step is
 *      Tests) whose checks pass (re)starts and completes Tests (→ READY); failing
 *      checks put the Tests step (or the change's latest planned step) on
 *      NEEDS_YOU with the first reason and ask the agent, in the change's
 *      conversation, to fix it.
 *
 * Edits run one at a time per workspace, and their code-writing part holds the
 * reactor project's codegen lock, so they never interleave with each other or
 * with the agent's codegen. The result's version is then a commit like any
 * other: it can be launched, and Go back restores from it.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Change, StepKind, StudioProductState } from "vetra-app/document-models/studio-product";
import { generateInProject } from "../commands/spec/generate.js";
import { messageAgent } from "../launch/compat-launch.js";
import {
  commitPaths,
  DEFAULT_AUTHOR,
  projectDirs,
  workingChanges,
  type GitAuthor,
} from "../launch/git-versions.js";
import { phBuildNodeOptions } from "../helpers/node-memory.js";
import {
  checkResultsFromOutcome,
  runChecks,
  runReducerTests,
} from "../helpers/project-checks.js";
import { withProjectCodegenLock } from "../helpers/project-lock.js";
import { recordCheckRun } from "../lifecycle/check-recorder.js";
import { awaitsBase, prepareChangeBase, type ChangeBaseContext } from "./changes.js";
import { readCheckResults, type ObservedCheck } from "./check-results.js";
import {
  activeChange,
  dispatchProduct,
  IN_PROGRESS,
  getProductDoc,
  productActions,
  ProductRefusedError,
} from "./product-doc.js";
import { runSmoke } from "./smoke.js";

const TAG = "[studio-edit]";

export type RunProcess = (
  command: string,
  opts?: { label?: string; cwd?: string; timeout?: number; env?: Record<string, string> },
) => Promise<{ success: boolean; output: string }>;

/** The outside work an edit does; each has a real default. */
export interface StudioEditDeps {
  /** Regenerate the project's code from its specs; null when no codegen ran. */
  generate(base: string, ctx: StudioEditContext): Promise<ObservedCheck | null>;
  /** TYPECHECK, LINT, REDUCER_TESTS and SMOKE for one reactor project. */
  check(base: string, ctx: StudioEditContext): Promise<ObservedCheck[]>;
  messageAgent: typeof messageAgent;
  prepareChangeBase: typeof prepareChangeBase;
}

export interface StudioEditContext extends ChangeBaseContext {
  workdir: string;
  runProcess: RunProcess;
  /** The conversation the edit was made from: a change it starts is linked to it. */
  chatSessionId?: string | null;
  /** The running preview's URL for a reactor project (SMOKE checks the screens there). */
  previewUrl?: (base: string) => string | undefined;
  author?: GitAuthor;
  now?: () => Date;
  editDeps?: Partial<StudioEditDeps>;
}

export interface StudioEdit {
  /** The change's request, when the edit starts one. */
  request: string;
  /** The milestone (and commit message) the edit adds. */
  milestone: string;
  /** One customer-facing sentence: what the edit did. */
  outcome: string;
  /** Write the edit into the workspace; returns the workspace-relative files it touched. */
  write(workdir: string): Promise<string[]>;
}

export interface StudioEditResult {
  changeId: string;
  sha: string;
  checksPassed: boolean;
}

/** The edit can't be made right now (nothing was written). */
export class StudioEditRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioEditRefusedError";
  }
}

/** Statuses an edit joins instead of starting a change. */
const JOINABLE = new Set(["BUILDING", "READY", "PAUSED"]);

/** What the agent is told when an edit leaves the checks failing. */
export function fixChecksMessage(milestone: string, reason: string): string {
  return `The Studio made an edit ("${milestone}") and the checks no longer pass: ${reason} Please fix it.`;
}

/* ------------------------------------------------------------------------ */
/* Defaults                                                                  */
/* ------------------------------------------------------------------------ */

async function defaultGenerate(base: string, ctx: StudioEditContext): Promise<ObservedCheck | null> {
  // The full checks run right after, so codegen's own module checks are skipped.
  const result = await generateInProject({ skipChecks: true }, base, ctx.runProcess);
  return readCheckResults(result)?.find((r) => r.kind === "GENERATE") ?? null;
}

/** The same run as `reactor-project-check` with `tests: true`, over the whole project. */
async function defaultCheck(base: string, ctx: StudioEditContext): Promise<ObservedCheck[]> {
  const outcome = await runChecks(base, ctx.runProcess, { scope: "all" });
  const observed = checkResultsFromOutcome(outcome, base);
  const reducerTests = await runReducerTests(base, ctx.runProcess);
  if (reducerTests) observed.push(reducerTests);
  observed.push(
    await runSmoke(base, {
      // A Studio edit only happens in a workspace with a product document.
      requireExamples: true,
      previewUrl: ctx.previewUrl?.(base),
      build: (projectPath) =>
        ctx.runProcess("ph build", {
          timeout: 120_000,
          cwd: projectPath,
          env: { FORCE_COLOR: "1", NODE_OPTIONS: phBuildNodeOptions() },
        }),
    }),
  );
  return observed;
}

const defaultDeps: StudioEditDeps = {
  generate: defaultGenerate,
  check: defaultCheck,
  messageAgent,
  prepareChangeBase,
};

/* ------------------------------------------------------------------------ */
/* Serialisation                                                             */
/* ------------------------------------------------------------------------ */

const queues = new Map<string, Promise<unknown>>();

/** Run `fn` after every earlier edit of this workspace has finished. */
function serialised<T>(workdir: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(workdir);
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/** Hold the codegen lock of every project in `bases` (in order) around `fn`. */
function withLocks<T>(bases: string[], fn: () => Promise<T>): Promise<T> {
  return bases.reduceRight<() => Promise<T>>(
    (inner, base) => () => withProjectCodegenLock(base, inner),
    fn,
  )();
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

/** One result per kind across projects: passes only when every project's passed. */
function mergeResults(results: ObservedCheck[]): ObservedCheck[] {
  const byKind = new Map<string, ObservedCheck>();
  for (const r of results) {
    const seen = byKind.get(r.kind);
    if (!seen || (seen.passed && !r.passed)) byKind.set(r.kind, r);
  }
  return [...byKind.values()];
}

function firstReason(results: ObservedCheck[]): string {
  const failed = results.find((r) => !r.passed);
  if (!failed) return "The checks didn't run.";
  return failed.reason ?? `The ${failed.kind.toLowerCase().replace(/_/g, " ")} check didn't pass.`;
}

async function readState(ctx: StudioEditContext): Promise<StudioProductState> {
  const product = await getProductDoc(ctx);
  if (!product) throw new StudioEditRefusedError("There is no product in this Studio yet.");
  return product.state;
}

/**
 * The change an edit joins: the active change when it can be worked on; null
 * when nothing is in progress (one is started). Any other change in progress
 * (one going live, or one that isn't the active change, which the check runs
 * couldn't be recorded on) refuses the edit.
 */
export function editTarget(state: StudioProductState): Change | null {
  const active = activeChange(state);
  if (active && JOINABLE.has(active.status)) return active;
  const busy = state.changes.find((c) => IN_PROGRESS.includes(c.status));
  if (!busy) return null;
  throw new StudioEditRefusedError(
    busy.status === "LAUNCHING"
      ? "A version is going live; try again once it is live."
      : "Another change is in progress; finish or discard it first.",
  );
}

/** A change only the Studio worked on: Tests is its only planned step before Live. */
function studioShaped(change: Change): boolean {
  const work = change.steps.filter((s) => s.kind !== "LIVE");
  return work.length === 1 && work[0].kind === "TESTS";
}

/** The step a failing check is shown on: Tests, else the latest planned step before Live. */
function attentionStep(change: Change): StepKind | null {
  if (change.steps.some((s) => s.kind === "TESTS")) return "TESTS";
  return change.steps.filter((s) => s.kind !== "LIVE").at(-1)?.kind ?? null;
}

/* ------------------------------------------------------------------------ */
/* applyStudioEdit                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Make `edit` as a normal change (see the module comment). Throws
 * `StudioEditRefusedError` (nothing written) when the Studio can't take an edit
 * now; a failure while writing or committing is thrown as it is.
 */
export function applyStudioEdit(ctx: StudioEditContext, edit: StudioEdit): Promise<StudioEditResult> {
  return serialised(ctx.workdir, () => runEdit(ctx, edit));
}

async function runEdit(ctx: StudioEditContext, edit: StudioEdit): Promise<StudioEditResult> {
  const d: StudioEditDeps = { ...defaultDeps, ...ctx.editDeps };
  const now = () => (ctx.now ?? (() => new Date()))().toISOString();
  const dirs = await projectDirs(ctx.workdir, null);
  if (dirs.length === 0) throw new StudioEditRefusedError("There is no project to edit yet.");
  const bases = dirs.map((dir) => path.join(ctx.workdir, dir));

  // 1. Join the change in progress, or start one from the live code.
  let state = await readState(ctx);
  let change = editTarget(state);
  const started = change === null;
  if (!change) {
    const id = randomUUID();
    await dispatchProduct(ctx, [
      productActions.startChange({
        id,
        kind: "CHANGE",
        request: edit.request,
        chatSessionId: ctx.chatSessionId ?? null,
        startedAt: now(),
      }),
    ]);
    state = await readState(ctx);
    change = state.changes.find((c) => c.id === id)!;
    let baseError: unknown = null;
    try {
      await d.prepareChangeBase(ctx, change, { state });
    } catch (err) {
      baseError = err;
    }
    // Planned at once, so an agent turn on this change never resets its code.
    try {
      await dispatchProduct(ctx, [
        productActions.planSteps({ changeId: id, steps: [{ kind: "TESTS", total: null }] }),
        productActions.startStep({ changeId: id, kind: "TESTS", at: now() }),
      ]);
    } catch (err) {
      ctx.log?.warn?.(`${TAG} change ${id}: Tests not planned: ${message(err)}`);
      throw new StudioEditRefusedError("The change couldn't be set up for this edit.");
    }
    if (baseError) {
      ctx.log?.warn?.(`${TAG} change ${id}: live code not restored: ${message(baseError)}`);
      const reason = "The edit couldn't start from the live version's code.";
      await needsYou(ctx, id, "TESTS", reason, now());
      throw new StudioEditRefusedError(reason);
    }
  } else if (awaitsBase(change)) {
    // A change the agent hasn't started on yet: give it its base now, so the
    // agent's own base step (idempotent) never resets this edit away.
    try {
      await d.prepareChangeBase(ctx, change, { state });
    } catch (err) {
      ctx.log?.warn?.(`${TAG} change ${change.id}: live code not restored: ${message(err)}`);
      throw new StudioEditRefusedError("The edit couldn't start from the live version's code.");
    }
  }
  const changeId = change.id;

  // 2. Write, regenerate when the change has no codegen result yet, commit.
  const needsGenerate = !change.checkRuns.some((r) => r.results.some((x) => x.kind === "GENERATE"));
  let generated: ObservedCheck | null = null;
  let generatedAt = now();
  let sha: string;
  try {
    ({ generated, generatedAt, sha } = await withLocks(bases, async () => {
      const files = await edit.write(ctx.workdir);
      let codegenFiles: string[] = [];
      let gen: ObservedCheck | null = null;
      if (needsGenerate) {
        const before = new Set(await workingChanges(ctx.workdir));
        const results: ObservedCheck[] = [];
        for (const base of bases) {
          let r: ObservedCheck | null;
          try {
            r = await d.generate(base, ctx);
          } catch (err) {
            r = { kind: "GENERATE", passed: false, reason: "Code couldn't be generated.", detail: message(err) };
          }
          if (r) results.push(r);
        }
        gen = results.length > 0 ? mergeResults(results)[0] : null;
        codegenFiles = (await workingChanges(ctx.workdir)).filter((f) => !before.has(f));
      }
      const at = now();
      const commit = await commitPaths(ctx.workdir, [...files, ...codegenFiles], edit.milestone, {
        author: ctx.author ?? DEFAULT_AUTHOR,
      });
      return { generated: gen, generatedAt: at, sha: commit.sha };
    }));
  } catch (err) {
    if (started) await needsYou(ctx, changeId, "TESTS", "The edit couldn't be saved.", now());
    throw err;
  }

  // 3. Milestone, checks, records.
  await dispatchProduct(ctx, [
    productActions.addMilestone({
      changeId,
      id: randomUUID(),
      text: edit.milestone,
      outcome: edit.outcome,
      at: now(),
    }),
  ]);
  if (generated) await recordCheckRun(ctx, [generated], generatedAt, ctx.log);
  const checkedAt = now();
  const perProject: ObservedCheck[] = [];
  for (const base of bases) perProject.push(...(await d.check(base, ctx)));
  const checks = mergeResults(perProject);
  await recordCheckRun(ctx, checks, checkedAt, ctx.log);
  const all = generated ? [generated, ...checks] : checks;
  let checksPassed = checks.length > 0 && all.every((r) => r.passed);
  let reason = firstReason(all);
  // Like the agent's spec-generate (Ruling F1), no GENERATE is recorded when no
  // spec has codegen; the Tests gate then can't be met, and that is said plainly.
  const nothingGenerated = needsGenerate && generated === null;
  if (checksPassed && nothingGenerated) {
    checksPassed = false;
    reason = "There's no generated code to check yet, so Tests can't be finished.";
  }

  // 4. Ready, or needs-you and a note to the agent.
  const current = (await readState(ctx)).changes.find((c) => c.id === changeId);
  const studioMade = started || (current ? studioShaped(current) : false);
  if (checksPassed && studioMade) {
    try {
      const at = now();
      await dispatchProduct(ctx, [
        // (Re)start first: an earlier failing edit may have left Tests on NEEDS_YOU.
        productActions.startStep({ changeId, kind: "TESTS", at }),
        productActions.completeStep({ changeId, kind: "TESTS", at }),
      ]);
    } catch (err) {
      if (!(err instanceof ProductRefusedError)) throw err;
      checksPassed = false;
      reason = "The check results couldn't be saved, so Tests can't be finished.";
      ctx.log?.warn?.(`${TAG} change ${changeId}: Tests not done: ${err.message}`);
    }
  }
  if (!checksPassed) {
    const latest = (await readState(ctx)).changes.find((c) => c.id === changeId);
    const step = latest ? attentionStep(latest) : null;
    if (step) await needsYou(ctx, changeId, step, reason, now());
    const session = latest?.chatSessionIds?.at(-1) ?? latest?.chatSessionId ?? null;
    if (session) {
      try {
        await d.messageAgent(ctx, session, fixChecksMessage(edit.milestone, reason), now());
      } catch (err) {
        ctx.log?.warn?.(`${TAG} change ${changeId}: the agent couldn't be told: ${message(err)}`);
      }
    } else {
      ctx.log?.warn?.(`${TAG} change ${changeId} has no conversation to tell the agent in`);
    }
  }
  return { changeId, sha, checksPassed };
}

async function needsYou(
  ctx: StudioEditContext,
  changeId: string,
  kind: StepKind,
  reason: string,
  at: string,
): Promise<void> {
  try {
    await dispatchProduct(ctx, [
      productActions.setStepAttention({ changeId, kind, status: "NEEDS_YOU", reason, at }),
    ]);
  } catch (err) {
    ctx.log?.warn?.(`${TAG} change ${changeId}: ${kind} not marked: ${message(err)}`);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
