/**
 * The Versions panel as data (spec §5.7, G7): every launch, newest first,
 * the live one marked, and what each row offers — Go back, or Undo with the
 * agent when the product's data can't go back (D6, Ruling F26). Pure: built
 * from the normalised product state only.
 */
import type {
  ChangeStatus,
  RequestFailure,
  StudioProductState,
  Version,
} from "document-models/studio-product";

/* ---------- copy (spec §5.7, exact where the spec gives it) ---------- */

/** Ruling E6: Go back while a change is open. */
export const FINISH_YOUR_CHANGE_FIRST = "Finish or discard your change first.";
/** The plain reason the agent stores when the Studio has unsaved changes
 *  (vetra-cli `DRAFT_OPEN_REASON`); the page shows E6's sentence instead. */
export const DRAFT_OPEN_REASON = "your change isn't finished";
export const GO_BACK = "Go back";
export const UNDO_WITH_THE_AGENT = "Undo with the agent";
export const WHAT_CHANGED = "What changed";
export const VERSIONS = "Versions";
export const BUILT_BY_VETRA = "built by Vetra";
export const YOU = "you";

/** "Make Version 2 live again? …" — the Go back confirmation. */
export function goBackConfirmText(target: number, live: number): string {
  return `Make Version ${target} live again? Your users' documents stay as they are. Changes made after Version ${target} aren't deleted — you can come back to Version ${live} any time.`;
}

/** What Undo with the agent asks for (spec §5.7, Task 3.3). */
export function undoRequest(title: string): string {
  return `Undo '${title}' but keep existing data`;
}

/** "Making Version 2 live again…" while the agent works on a Go back. */
export function goingBackText(target: number): string {
  return `Making Version ${target} live again…`;
}

/** A Go back the agent couldn't carry out (X28), in the page's words. */
export function requestFailureText(failure: RequestFailure): string {
  return failure.reason.trim() === DRAFT_OPEN_REASON
    ? FINISH_YOUR_CHANGE_FIRST
    : failure.reason;
}

/* ---------- rows ---------- */

export type VersionAction = "go-back" | "undo-with-agent" | "none";

export interface VersionRow {
  number: number;
  title: string;
  /** "today 14:02", "yesterday", "Oct 18"; "Going live…" while launching. */
  when: string;
  who: typeof YOU | typeof BUILT_BY_VETRA;
  live: boolean;
  action: VersionAction;
  /** Why Go back isn't offered (the agent's plain sentence, F26). */
  blockedReason?: string;
  whatChanged: { summary: string; files: string[]; commitUrl?: string };
}

/** Changes that are still open (Ruling E6; mirrors REQUEST_ROLLBACK). */
const OPEN: readonly ChangeStatus[] = [
  "BUILDING",
  "PAUSED",
  "READY",
  "LAUNCHING",
];

/** `launchedBy` of a launch the agent ran by itself (vetra-cli
 *  `AUTO_LAUNCHED_BY`): Ruling F52 shows it as "built by Vetra". */
const AUTO_LAUNCHED_BY = "vetra";

function who(version: Version): VersionRow["who"] {
  const by = version.launchedBy.trim().toLowerCase();
  return by === "" || by === AUTO_LAUNCHED_BY ? BUILT_BY_VETRA : YOU;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "today 14:02", "yesterday", "Oct 18" (", 2025" in another year). */
export function whenText(at: string | null, now: Date): string {
  if (!at) return "Going live…";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  if (sameDay(date, now)) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `today ${hh}:${mm}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "yesterday";
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear()
    ? day
    : `${day}, ${date.getFullYear()}`;
}

function commitUrl(
  product: StudioProductState,
  version: Version,
): string | undefined {
  const repo = product.github.repoFullName;
  if (product.github.status !== "CONNECTED" || !repo || !version.sha) {
    return undefined;
  }
  return `https://github.com/${repo}/commit/${version.sha}`;
}

/**
 * Whether Go back to `version` can be offered at all: a version that was
 * live before, with a deployment to bring back, that the product's data can
 * live with (F26: a blocked one never shows a plain Go back).
 */
export function goBackOffered(version: Version | undefined): boolean {
  return (
    version?.status === "PREVIOUS" &&
    !!version.deploymentId &&
    !version.rollbackBlockedReason
  );
}

function rowAction(version: Version): {
  action: VersionAction;
  blockedReason?: string;
} {
  if (version.status !== "PREVIOUS" || !version.deploymentId) {
    return { action: "none" };
  }
  if (version.rollbackBlockedReason) {
    return {
      action: "undo-with-agent",
      blockedReason: version.rollbackBlockedReason,
    };
  }
  return { action: "go-back" };
}

/**
 * Every launch, newest first; the live one marked. Versions whose launch
 * failed are not listed (Ruling F23: a version is a launched change).
 * `doc` is the normalised product state.
 */
export function versionRows(doc: StudioProductState, now: Date): VersionRow[] {
  return doc.versions
    .filter((v) => v.status !== "FAILED")
    .sort((a, b) => b.number - a.number)
    .map((v) => {
      const url = commitUrl(doc, v);
      return {
        number: v.number,
        title: v.title,
        when: whenText(v.launchedAt ?? null, now),
        who: who(v),
        live: v.number === doc.liveVersion,
        ...rowAction(v),
        whatChanged: {
          summary: v.summary ?? "",
          files: [...v.changedFiles],
          ...(url ? { commitUrl: url } : {}),
        },
      };
    });
}

/**
 * Why Go back (and Undo with the agent) can't be pressed now, or null.
 * Mirrors what REQUEST_ROLLBACK / START_CHANGE refuse, so a press never
 * fails on something the page already knew.
 */
export function goBackDisabledReason(doc: StudioProductState): string | null {
  if (doc.changes.some((c) => OPEN.includes(c.status))) {
    return FINISH_YOUR_CHANGE_FIRST;
  }
  const launching = doc.versions.find((v) => v.status === "LAUNCHING");
  if (launching) return `Wait until Version ${launching.number} is live.`;
  const pending = doc.pendingRequest;
  if (pending) {
    return pending.kind === "ROLLBACK" && pending.targetVersion != null
      ? goingBackText(pending.targetVersion)
      : "Wait until your last request is done.";
  }
  return null;
}

/** The last Go back that couldn't be carried out, while it still applies
 *  (until the live version moves on, as on the live page). */
export function failedGoBack(doc: StudioProductState): string | null {
  const failed = doc.lastRequestFailure;
  if (!failed || failed.kind !== "ROLLBACK") return null;
  const since = doc.liveSince ? Date.parse(doc.liveSince) : 0;
  if (Date.parse(failed.at) <= since) return null;
  return requestFailureText(failed);
}
