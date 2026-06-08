/**
 * Auto-navigation target selection (pure, unit-testable).
 *
 * The studio follows the document the agent is currently working on: as the
 * agent creates AND fills in ideation sheets, the view tracks whichever sheet
 * was most recently touched. We key off the document headers'
 * `lastModifiedAtUtcIso` (creation bumps it too), so a burst of fast creations
 * followed by spaced-out edits walks the view through each sheet as it fills in
 * — rather than jumping straight to the last-created one.
 *
 * Decision logic lives here so it can be tested without a React renderer —
 * mirroring `hooks/useSessionPreviewTarget.ts`.
 */
import type { OpenTarget } from "./ideation/types.js";

/** Document types auto-nav follows — the five ideation sheets (the set
 * `DocumentHost` can render inline). Builder/project specs (document-model,
 * editor, app) belong to the SPECIFY phase and are out of MVP scope. */
export const AUTO_NAV_TYPES: ReadonlySet<string> = new Set([
  "powerhouse/brand-sheet",
  "powerhouse/problem-sheet",
  "powerhouse/audience-sheet",
  "powerhouse/feature",
  "powerhouse/work-breakdown-structure",
]);

/** Minimal structural shape of a resolved document we read (a subset of
 * PHDocument). `useDocumentsInSelectedDrive()` returns these. */
export type DocLike = {
  header: {
    id: string;
    name: string;
    documentType: string;
    lastModifiedAtUtcIso: string | Date;
  };
};

/** An auto-nav candidate: an OpenTarget plus the modified-time (epoch ms) used
 * to decide whether it's newer than what we've already followed. */
export type TouchedTarget = OpenTarget & { ts: number };

function toMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * The navigable document most recently created-or-modified. Returns `null` when
 * the drive has no navigable documents. On ties the later entry in `docs` wins
 * (documents are appended in creation order, so this prefers the newest).
 */
export function latestTouchedNavigable(
  docs: readonly DocLike[],
): TouchedTarget | null {
  let best: TouchedTarget | null = null;
  for (const doc of docs) {
    const h = doc.header;
    if (!AUTO_NAV_TYPES.has(h.documentType)) continue;
    const ts = toMs(h.lastModifiedAtUtcIso);
    if (Number.isNaN(ts)) continue;
    if (!best || ts >= best.ts) {
      best = { id: h.id, documentType: h.documentType, name: h.name, ts };
    }
  }
  return best;
}
