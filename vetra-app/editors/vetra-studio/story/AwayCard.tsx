import type { StudioProductState } from "document-models/studio-product";
import { useEffect, useState } from "react";
import { awaySummary, readLastVisit, writeLastVisit } from "./awayCard.js";

/** The visit time read when this page visit first opened a Studio, so a
 *  remount (view or dock switch) keeps showing the same card. */
const dismissedStudios = new Set<string>();
const sinceByStudio = new Map<string, number | null>();
function sinceFor(studioId: string): number | null {
  if (!sinceByStudio.has(studioId)) {
    sinceByStudio.set(studioId, readLastVisit(studioId));
  }
  return sinceByStudio.get(studioId) ?? null;
}
/** Test hook: forget the cached visit times (a new page visit). */
export function resetAwayCardVisits(): void {
  sinceByStudio.clear();
  dismissedStudios.clear();
}

/** A dismissible card for a returning customer; nothing on a first visit. */
export function AwayCard({
  studioId,
  product,
  question,
}: {
  studioId: string;
  product: StudioProductState;
  question?: string | null;
}) {
  // Read once on open: the visit time is written on leaving, not on arrival.
  const [since] = useState(() => sinceFor(studioId));
  const [dismissed, setDismissed] = useState(() => dismissedStudios.has(studioId));
  const summary =
    since === null || dismissed ? null : awaySummary(product, since, question);

  useEffect(() => {
    const save = () => writeLastVisit(studioId, Date.now());
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [studioId]);

  if (!summary) return null;
  return (
    <section
      data-away-card
      className="mb-3 rounded-xl border border-border bg-card px-3 py-2 text-sm"
    >
      <h3 className="font-medium text-foreground">While you were away</h3>
      {summary.outcomes.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-foreground">
          {summary.outcomes.map((o) => (
            <li key={o.id}>{o.text}</li>
          ))}
        </ul>
      ) : null}
      {summary.waiting.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-amber-700 dark:text-amber-400">
          {summary.waiting.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={() => {
          const now = Date.now();
          writeLastVisit(studioId, now);
          sinceByStudio.set(studioId, now);
          dismissedStudios.add(studioId);
          setDismissed(true);
        }}
        className="mt-2 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
      >
        Got it
      </button>
    </section>
  );
}
