/**
 * Time left on the strip (spec §5.2, designer's call D9; ruling F17).
 *
 * Shown only once the plan exists: the planned work still to do (models,
 * screens, checks) times the measured seconds per unit, less the time spent
 * since the build last moved, rounded up to whole minutes — `~N min left`.
 * When the estimate is used up it reads `taking longer than usual`: never
 * negative, and never more minutes than the estimate shown before (`prev`),
 * so the number never jumps back up.
 */
import type { Change, ProductStep } from "document-models/studio-product";
import measured from "./phase-averages.json" with { type: "json" };

/** Measured seconds per unit of planned work. */
export type PhaseAverages = Partial<
  Record<"model" | "editor" | "check", number>
>;

export const TAKING_LONGER = "taking longer than usual";

/** The averages the Studio ships with (`phase-averages.json`). */
export const PHASE_AVERAGES: PhaseAverages = readAverages(measured.averages);

/** The steps whose planned units are timed, with the unit each one counts. */
const TIMED_STEPS = [
  ["DATA", "model"],
  ["EDITORS", "editor"],
  ["TESTS", "check"],
] as const;

/** Change states with work still running (or paused) toward a version. */
const IN_PROGRESS = new Set(["BUILDING", "PAUSED"]);

function readAverages(raw: Record<string, unknown>): PhaseAverages {
  const out: PhaseAverages = {};
  for (const key of ["model", "editor", "check"] as const) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[key] = value;
    }
  }
  return out;
}

function ms(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

/** Units still to do in a step: none once done, at least one until then. */
function remainingUnits(step: ProductStep): number {
  if (step.status === "DONE") return 0;
  if (step.total == null) return 1;
  return Math.max(1, step.total - (step.done ?? 0));
}

/** The last time the build visibly moved (step change, milestone, check run). */
function lastProgress(change: Change): number {
  let t = ms(change.startedAt);
  for (const s of change.steps) t = Math.max(t, ms(s.updatedAt));
  for (const m of change.milestones) t = Math.max(t, ms(m.at));
  for (const r of change.checkRuns) t = Math.max(t, ms(r.at));
  return t;
}

/** A step is open again while a later step has already started (a back-step). */
function reopened(change: Change): boolean {
  const order = TIMED_STEPS.map(([kind]) => kind);
  const steps = order
    .map((kind) => change.steps.find((s) => s.kind === kind))
    .filter((s): s is ProductStep => s !== undefined);
  return steps.some(
    (step, i) =>
      step.status !== "DONE" &&
      steps.slice(i + 1).some((later) => later.status !== "NOT_STARTED"),
  );
}

/** Minutes in a previous `~N min left`; 0 for `taking longer than usual`. */
function minutesIn(text: string): number | null {
  if (text === TAKING_LONGER) return 0;
  const match = /^~(\d+) min left$/.exec(text);
  return match ? Number(match[1]) : null;
}

function minutesText(minutes: number): string {
  return `~${minutes} min left`;
}

/**
 * The strip's time left for `change`, or null when there is nothing to
 * estimate (no plan yet, no planned work left, or the change isn't building).
 * `prev` is the value shown before for the same change; the result never
 * shows more minutes than it.
 */
export function timeLeft(
  change: Change | null,
  averages: PhaseAverages,
  now: Date,
  prev?: string | null,
): string | null {
  if (!change || !IN_PROGRESS.has(change.status)) return null;
  const previous = prev ? minutesIn(prev) : null;

  const plan = change.steps.find((s) => s.kind === "PLAN");
  if (plan?.status !== "DONE") {
    // The plan reopened after an estimate was shown: more work, not a reset.
    return previous === null ? null : TAKING_LONGER;
  }

  let seconds = 0;
  let units = 0;
  for (const [kind, unit] of TIMED_STEPS) {
    const step = change.steps.find((s) => s.kind === kind);
    if (!step) continue;
    const left = remainingUnits(step);
    if (left === 0) continue;
    const average = averages[unit];
    // No measurement for this kind of work: keep what was shown, if anything.
    if (average === undefined) return prev ?? null;
    units += left;
    seconds += left * average;
  }
  if (units === 0) return null;

  const spent = Math.max(0, (now.getTime() - lastProgress(change)) / 1000);
  const remaining = seconds - spent;
  if (remaining <= 0) return TAKING_LONGER;

  const minutes = Math.ceil(remaining / 60);
  if (previous === null || minutes <= previous) return minutesText(minutes);
  // More than shown before: reopened work is honestly slower than usual;
  // anything else (a unit finishing late) keeps the number shown.
  if (previous === 0 || reopened(change)) return TAKING_LONGER;
  return minutesText(previous);
}
