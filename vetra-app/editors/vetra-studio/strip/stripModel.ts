/**
 * The step strip as data (spec §5.2): pure, built from the product document
 * only, so the strip can show nothing the agent didn't record.
 */
import type {
  Change,
  GithubStatus,
  ProductStep,
  StepKind,
  StepStatus,
  StudioProductState,
  Version,
} from "document-models/studio-product";
import { timeLeft, type PhaseAverages } from "./timeLeft.js";

export type StepIcon = "○" | "◐" | "✓" | "!" | "✕" | "●";

export const STEP_ORDER: readonly StepKind[] = [
  "PLAN",
  "DATA",
  "EDITORS",
  "TESTS",
  "LIVE",
];

export const STEP_LABELS: Record<StepKind, string> = {
  PLAN: "Plan",
  DATA: "Data",
  EDITORS: "Editors",
  TESTS: "Tests",
  LIVE: "Live",
};

const STATUS_ICON: Record<StepStatus, StepIcon> = {
  NOT_STARTED: "○",
  WORKING: "◐",
  DONE: "✓",
  NEEDS_YOU: "!",
  STOPPED: "✕",
  LIVE: "●",
};

/** The state in words, so an icon is never the only signal. */
const STATUS_TEXT: Record<StepStatus, string> = {
  NOT_STARTED: "not started",
  WORKING: "working",
  DONE: "done",
  NEEDS_YOU: "needs you",
  STOPPED: "stopped",
  LIVE: "live",
};

export interface StripStep {
  kind: StepKind;
  status: StepStatus;
  icon: StepIcon;
  label: string;
  /** The step's state in words ("working", "stopped", …). */
  stateText: string;
  /** Progress while the step is active: "9 features", "2/3", "Going live…". */
  count?: string;
  clickable: boolean;
}

export type StripRight =
  | { budget: string; timeLeft?: string }
  | { liveUrl: string; deployedAgo: string; github: string };

/** A change's progress next to Live (§5.7): "◐ Change: Data 1/1 · Editors · Tests". */
export interface StripChangeProgress {
  icon: StepIcon;
  text: string;
}

export interface StripView {
  name: string;
  steps: StripStep[];
  right: StripRight;
  /** Set while a change is open on a live product. */
  change?: StripChangeProgress;
}

export type { PhaseAverages };

export interface StripInputs {
  budget: { spentUsd: number; limitUsd: number | null } | null;
  averages: PhaseAverages;
  now: Date;
  /** The previous estimate, so it never jumps back up (Task 1.7). */
  prevTimeLeft?: string | null;
}

/** Change statuses that mean "someone is still working on this change". */
const OPEN_STATUS: Record<Change["status"], boolean> = {
  BUILDING: true,
  PAUSED: true,
  READY: true,
  LAUNCHING: true,
  LAUNCHED: false,
  DISCARDED: false,
  FAILED: false,
  CLOSED: false,
};

function liveVersionOf(product: StudioProductState): Version | null {
  if (product.liveVersion === null) return null;
  return product.versions.find((v) => v.number === product.liveVersion) ?? null;
}

/**
 * The change being worked on, if any. While one is open on a live product
 * the page shows the Live | Preview split (Task 3.5).
 */
export function openChange(product: StudioProductState): Change | null {
  const active = product.changes.find((c) => c.id === product.activeChangeId);
  return active && OPEN_STATUS[active.status] ? active : null;
}

/**
 * The change the strip follows: the open change while one is in progress,
 * else the change behind the live version, else the newest change.
 */
export function stripChange(product: StudioProductState): Change | null {
  const open = openChange(product);
  if (open) return open;
  const active = product.changes.find((c) => c.id === product.activeChangeId);
  const live = liveVersionOf(product);
  const launched = live?.changeId
    ? product.changes.find((c) => c.id === live.changeId)
    : undefined;
  return launched ?? active ?? product.changes.at(-1) ?? null;
}

function countFor(step: ProductStep): string | undefined {
  if (step.status !== "WORKING") return undefined;
  if (step.kind === "LIVE") return "Going live…";
  if (step.kind === "PLAN") {
    if (step.total === null) return undefined;
    return `${step.total} ${step.total === 1 ? "feature" : "features"}`;
  }
  if (step.total === null) return undefined;
  return `${step.done ?? 0}/${step.total}`;
}

function stripStep(
  kind: StepKind,
  step: ProductStep | undefined,
  live: boolean,
): StripStep {
  const status: StepStatus =
    kind === "LIVE" && live ? "LIVE" : (step?.status ?? "NOT_STARTED");
  const count = step && status === step.status ? countFor(step) : undefined;
  return {
    kind,
    status,
    icon: STATUS_ICON[status],
    label: STEP_LABELS[kind],
    stateText: STATUS_TEXT[status],
    ...(count ? { count } : {}),
    clickable: status !== "NOT_STARTED",
  };
}

function usd(amount: number, wholeWhenRound: boolean): string {
  return wholeWhenRound && Number.isInteger(amount)
    ? `$${amount}`
    : `$${amount.toFixed(2)}`;
}

/** `$0.31 of $10`, `$0.31 used` without a limit, "" when unknown. */
export function budgetText(budget: StripInputs["budget"]): string {
  if (!budget) return "";
  if (budget.limitUsd === null) return `${usd(budget.spentUsd, false)} used`;
  return `${usd(budget.spentUsd, false)} of ${usd(budget.limitUsd, true)}`;
}

/** "<prefix> 2 min ago" (just now / min / h / days). */
export function agoText(prefix: string, at: string | null, now: Date): string {
  if (!at) return prefix;
  const minutes = Math.floor((now.getTime() - Date.parse(at)) / 60000);
  if (!(minutes >= 1)) return `${prefix} just now`;
  if (minutes < 60) return `${prefix} ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${prefix} ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${prefix} ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** "Deployed 2 min ago" (the product's `liveSince`, Task 2.9). */
export function deployedAgo(launchedAt: string | null, now: Date): string {
  return agoText("Deployed", launchedAt, now);
}

const GITHUB_TEXT: Record<GithubStatus, string> = {
  CONNECTED: "GitHub ✓",
  // M4 adds the Connect GitHub button; until then the line names it.
  NOT_CONNECTED: "Code saved in your Studio · Connect GitHub",
  DISCONNECTED: "GitHub disconnected",
  PUSH_FAILED: "Couldn't save to GitHub",
};

export function githubText(status: GithubStatus): string {
  return GITHUB_TEXT[status];
}

function withTimeLeft(budget: string, left: string | null): StripRight {
  return left ? { budget, timeLeft: left } : { budget };
}

/** One step in the change's line: "Data 1/1" working, "Data ✓" done. */
function changeStepText(step: ProductStep): string {
  const label = STEP_LABELS[step.kind];
  const count = countFor(step);
  if (count) return `${label} ${count}`;
  if (step.status === "DONE") return `${label} ✓`;
  if (step.status === "NEEDS_YOU") return `${label} !`;
  if (step.status === "STOPPED") return `${label} ✕`;
  return label;
}

/**
 * The open change's progress next to `● Live · v<n>` (spec §5.7): its
 * planned steps up to Tests — Live is the live version's.
 */
export function changeProgress(change: Change): StripChangeProgress {
  if (change.status === "LAUNCHING") {
    return { icon: "◐", text: "Change: Going live…" };
  }
  const steps = STEP_ORDER.filter((kind) => kind !== "LIVE")
    .map((kind) => change.steps.find((s) => s.kind === kind))
    .filter((s): s is ProductStep => s !== undefined);
  const text = `Change: ${steps.length > 0 ? steps.map(changeStepText).join(" · ") : "getting ready…"}`;
  const icon: StepIcon =
    change.status === "READY"
      ? "✓"
      : steps.some((s) => s.status === "NEEDS_YOU")
        ? "!"
        : "◐";
  return { icon, text };
}

/** The strip for a product (null while the product isn't readable yet). */
export function stripModel(
  product: StudioProductState | null,
  inputs: StripInputs,
): StripView {
  const name = product?.name?.trim() || "Your product";
  const change = product ? stripChange(product) : null;
  const live = product?.liveVersion != null;
  // Unhealthy: `● Live` turns amber (§5.9); the banner says why.
  const unhealthy = live && product.health === "UNHEALTHY";
  // A change on a live product (§5.7): the strip stays in live mode — the
  // live version's steps, `● Live · v<n>` — with the change's progress next
  // to it.
  const open = live ? openChange(product) : null;
  const liveNumber = live ? product.liveVersion : 0;
  const steps = STEP_ORDER.map((kind): StripStep => {
    const step = open
      ? liveModeStep(kind, liveNumber ?? 0)
      : stripStep(
          kind,
          change?.steps.find((s) => s.kind === kind),
          live,
        );
    return unhealthy && kind === "LIVE"
      ? { ...step, icon: "!", stateText: "not responding" }
      : step;
  });
  const right: StripRight =
    live && product.liveUrl
      ? {
          liveUrl: product.liveUrl,
          // "Deployed 2 min ago" reads liveSince, not the launch record.
          deployedAgo: deployedAgo(
            product.liveSince ?? liveVersionOf(product)?.launchedAt ?? null,
            inputs.now,
          ),
          github: githubText(product.github.status),
        }
      : withTimeLeft(
          budgetText(inputs.budget),
          timeLeft(change, inputs.averages, inputs.now, inputs.prevTimeLeft),
        );
  return open
    ? { name, steps, right, change: changeProgress(open) }
    : { name, steps, right };
}

/** The live version's strip while a change is open: its steps all done. */
function liveModeStep(kind: StepKind, liveVersion: number): StripStep {
  const status: StepStatus = kind === "LIVE" ? "LIVE" : "DONE";
  return {
    kind,
    status,
    icon: STATUS_ICON[status],
    label: STEP_LABELS[kind],
    stateText: STATUS_TEXT[status],
    ...(kind === "LIVE" ? { count: `· v${liveVersion}` } : {}),
    clickable: true,
  };
}
