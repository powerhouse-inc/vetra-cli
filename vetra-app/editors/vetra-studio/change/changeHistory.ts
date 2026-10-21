/**
 * The drawer's past changes (spec §5.6): grouped by version, newest first —
 * "Version 3 — Added a Ready column" over the request that made it, then the
 * changes thrown away while that version was live, marked discarded (§5.7:
 * nothing is deleted silently). Pure, from the product document only.
 */
import {
  currentSuggestions,
  type Change,
  type StudioProductState,
  type Suggestion,
} from "document-models/studio-product";
import { changeTitle, versionHeading } from "./changeCopy.js";

export interface HistoryEntry {
  changeId: string;
  text: string;
  discarded: boolean;
}

export interface HistoryGroup {
  version: number;
  heading: string;
  entries: HistoryEntry[];
}

function time(at: string | null | undefined): number {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function entry(change: Change, discarded: boolean): HistoryEntry {
  return { changeId: change.id, text: changeTitle(change), discarded };
}

/** Past changes grouped by launched version, newest version first. */
export function changeHistory(product: StudioProductState): HistoryGroup[] {
  // F23: a launch that failed isn't a version.
  const versions = product.versions
    .filter((v) => v.status !== "FAILED")
    .sort((a, b) => b.number - a.number);
  if (versions.length === 0) return [];
  const groups = versions.map((v): HistoryGroup => {
    const made = v.changeId
      ? product.changes.find((c) => c.id === v.changeId)
      : undefined;
    return {
      version: v.number,
      heading: versionHeading(v.number, v.title),
      entries: made ? [entry(made, false)] : [],
    };
  });
  // A discarded change belongs to the version that was live when it started
  // (the newest launched before it), else to the oldest one.
  const discarded = product.changes
    .filter((c) => c.status === "DISCARDED")
    .sort((a, b) => time(a.startedAt) - time(b.startedAt));
  for (const change of discarded) {
    const started = time(change.startedAt);
    const index = versions.findIndex((v) => time(v.launchedAt) <= started);
    groups[index === -1 ? groups.length - 1 : index].entries.push(
      entry(change, true),
    );
  }
  return groups;
}

/** The agent's open suggestions for the live version (§5.8), at most three. */
export function openSuggestions(product: StudioProductState): Suggestion[] {
  return currentSuggestions(product).slice(0, 3);
}
