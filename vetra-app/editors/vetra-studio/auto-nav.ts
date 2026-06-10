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
import { SPECIFY_TYPES } from "./specify/projects.js";

/** The five ideation sheet types (the set `DocumentHost` can render inline). */
export const IDEATION_TYPES: ReadonlySet<string> = new Set([
  "powerhouse/brand-sheet",
  "powerhouse/problem-sheet",
  "powerhouse/audience-sheet",
  "powerhouse/feature",
  "powerhouse/work-breakdown-structure",
]);

/**
 * The section a document opens in, by type: ideation sheets → IDEATE,
 * builder spec types → SPECIFY. `null` = no inline editor for it (folders,
 * custom models) — not followable/openable. Single source of truth for
 * navigability: auto-nav follows exactly the non-null types.
 */
export function sectionForDocumentType(
  documentType: string,
): "ideate" | "specify" | null {
  if (IDEATION_TYPES.has(documentType)) return "ideate";
  if (SPECIFY_TYPES.has(documentType)) return "specify";
  return null;
}

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
 * to decide whether it's newer than what we've already followed, and the
 * section the document opens in. */
export type TouchedTarget = OpenTarget & {
  ts: number;
  section: "ideate" | "specify";
};

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
    const section = sectionForDocumentType(h.documentType);
    if (!section) continue;
    const ts = toMs(h.lastModifiedAtUtcIso);
    if (Number.isNaN(ts)) continue;
    if (!best || ts >= best.ts) {
      best = {
        id: h.id,
        documentType: h.documentType,
        name: h.name,
        ts,
        section,
      };
    }
  }
  return best;
}
