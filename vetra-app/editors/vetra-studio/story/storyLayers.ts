/**
 * Three layers over one story (spec §5.4, G1): Outcome reads as customer
 * sentences, Activity (the default) is one summary per milestone, Raw keeps
 * everything. All three are views of the lines `storyLines` builds; nothing
 * here changes the product.
 */
import type { Change, CheckRun } from "document-models/studio-product";
import { foldedFailures, activitySummary } from "./activity.js";
import type { StoryLine } from "./storyModel.js";

export type StoryLayer = "outcome" | "activity" | "raw";
export const DEFAULT_LAYER: StoryLayer = "activity";

export type OutcomeLine = { id: string; at: string; text: string };

type MilestoneLine = Extract<StoryLine, { kind: "milestone" }>;

function time(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** One per milestone, in the customer's words (the title when none). */
export function outcomeLines(change: Change): OutcomeLine[] {
  return [...change.milestones]
    .sort((a, b) => time(a.at) - time(b.at))
    .map((m) => ({ id: m.id, at: m.at, text: m.outcome ?? m.text }));
}

/**
 * Check runs per milestone line. A milestone's window starts at its own time
 * and ends at the next milestone's; runs before the first milestone belong to
 * the first milestone line (the idea line carries none). The active line
 * takes over the newest milestone's window (it owns that detail), so the
 * milestone before it keeps no runs.
 */
function windows(
  lines: readonly MilestoneLine[],
  runs: readonly CheckRun[],
): Map<string, CheckRun[]> {
  const sorted = [...runs].sort((a, b) => time(a.at) - time(b.at));
  const result = new Map<string, CheckRun[]>();
  lines.forEach((line, i) => {
    const active = line.id.startsWith("active:");
    const previous = lines[i - 1];
    const next = lines[i + 1];
    const start = active
      ? previous
        ? time(previous.at)
        : -Infinity
      : i === 0
        ? -Infinity
        : time(line.at);
    const end = next
      ? next.id.startsWith("active:")
        ? start
        : time(next.at)
      : Infinity;
    result.set(
      line.id,
      sorted.filter((r) => time(r.at) >= start && time(r.at) < end),
    );
  });
  return result;
}

/**
 * What a window's summary may say about checks. Only the newest run overall
 * can read "failing". A window whose last run failed and was fixed later
 * reads as recovered: the runs from its first failure up to the first
 * all-pass run after it. A past failure never fixed has nothing to say.
 */
function summaryRuns(
  windowRuns: readonly CheckRun[],
  all: readonly CheckRun[],
): CheckRun[] {
  const last = windowRuns.at(-1);
  if (!last) return [];
  const passes = (r: CheckRun) => r.results.every((x) => x.passed);
  let runs = [...windowRuns];
  if (!passes(last) && last !== all.at(-1)) {
    const after = all.slice(all.indexOf(last) + 1);
    const fix = after.findIndex(passes);
    if (fix === -1) {
      const lastPass = runs.findLastIndex(passes);
      return runs.slice(0, lastPass + 1);
    }
    runs = [...runs, ...after.slice(0, fix + 1)];
  }
  const firstFail = runs.findIndex((r) => !passes(r));
  return firstFail === -1 ? runs : runs.slice(firstFail);
}

function activityLines(
  lines: readonly StoryLine[],
  change: Change,
): StoryLine[] {
  const milestones = lines.filter(
    (l): l is MilestoneLine => l.kind === "milestone",
  );
  const runsOf = windows(milestones, change.checkRuns);
  const sorted = [...change.checkRuns].sort((a, b) => time(a.at) - time(b.at));
  const open = foldedFailures(sorted).open;
  const firstMilestone = milestones[0]?.id;
  const early = lines.find((l) => l.kind === "idea")?.detail ?? [];
  const lastReply = lines.findLast((l) => l.kind === "reply");

  const out: StoryLine[] = [];
  let afterSteer = false;
  for (const line of lines) {
    switch (line.kind) {
      case "milestone":
        // Work before the first milestone counts in the first summary.
        out.push({
          ...line,
          summary: activitySummary(
            line.id === firstMilestone
              ? [...early, ...line.detail]
              : line.detail,
            summaryRuns(runsOf.get(line.id) ?? [], sorted),
          ),
        });
        break;
      case "checks":
        if (open && line.id === `checks:${open.id}`) out.push(line);
        break;
      case "reply":
        if (line.question || line === lastReply || afterSteer) {
          out.push(line);
        }
        afterSteer = false;
        break;
      case "steer":
        afterSteer = true;
        out.push(line);
        break;
      default:
        out.push(line);
    }
  }
  return out;
}

function outcomeLayer(
  lines: readonly StoryLine[],
  change: Change,
): StoryLine[] {
  const open = foldedFailures(
    [...change.checkRuns].sort((a, b) => time(a.at) - time(b.at)),
  ).open;
  const marks = new Map(
    lines.flatMap((l) => (l.kind === "milestone" ? [[l.id, l.mark]] : [])),
  );
  const done: StoryLine[] = outcomeLines(change).map((o) => ({
    kind: "milestone",
    id: o.id,
    at: o.at,
    mark: marks.get(o.id) ?? "✓",
    text: o.text,
    detail: [],
    doingNow: null,
    outcome: o.text,
    summary: "",
  }));
  const waiting = lines.filter(
    (l) =>
      l.kind === "stuck" ||
      l.kind === "attention" ||
      l.kind === "paused" ||
      (open !== null && l.id === `checks:${open.id}`) ||
      (l.kind === "reply" && l.question),
  );
  const idea = lines.filter((l) => l.kind === "idea");
  const rest = [...done, ...waiting].sort((a, b) => time(a.at) - time(b.at));
  return [...idea, ...rest];
}

/** The lines the chosen layer shows. */
export function layerLines(
  lines: StoryLine[],
  change: Change,
  layer: StoryLayer,
): StoryLine[] {
  if (layer === "raw") return lines;
  if (layer === "outcome") return outcomeLayer(lines, change);
  return activityLines(lines, change);
}
