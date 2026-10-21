/**
 * "While you were away": what changed since the customer's last visit and
 * what is waiting for them. The last visit is kept per Studio in
 * localStorage; blocked storage just means no card.
 */
import type { StudioProductState } from "document-models/studio-product";
import { outcomeLines, type OutcomeLine } from "./storyLayers.js";

export const LAST_VISIT_KEY = (studioId: string): string =>
  `vetra-studio:last-visit:${studioId}`;

export const READY_WAITING_TEXT = "Your change is ready to go live.";

export function readLastVisit(studioId: string): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_VISIT_KEY(studioId));
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastVisit(studioId: string, ms: number): void {
  try {
    window.localStorage.setItem(LAST_VISIT_KEY(studioId), String(ms));
  } catch {
    // Blocked storage: the card just doesn't show next time.
  }
}

export type AwaySummary = { outcomes: OutcomeLine[]; waiting: string[] };

/**
 * Outcomes of every change's milestones after `since`, plus what waits for
 * the customer: the open question (`question`, from the story, which needs
 * the chat), needs-you / stopped step reasons, a ready change. Null when
 * both are empty.
 */
export function awaySummary(
  product: StudioProductState,
  since: number,
  question?: string | null,
): AwaySummary | null {
  const outcomes = product.changes
    .flatMap((change) => outcomeLines(change))
    .filter((line) => Date.parse(line.at) > since)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const waiting: string[] = [];
  if (question) waiting.push(question);
  for (const change of product.changes) {
    for (const step of change.steps) {
      if (step.status === "NEEDS_YOU" || step.status === "STOPPED") {
        waiting.push(step.reason ?? "This step needs you.");
      }
    }
    if (change.status === "READY") waiting.push(READY_WAITING_TEXT);
  }
  const unique = [...new Set(waiting)];
  return outcomes.length === 0 && unique.length === 0
    ? null
    : { outcomes, waiting: unique };
}
