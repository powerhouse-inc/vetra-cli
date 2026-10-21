import type { StudioProductState } from "document-models/studio-product";
import { useEffect, useState } from "react";
import { awaySummary, readLastVisit, writeLastVisit } from "./awayCard.js";

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
  const [since] = useState(() => readLastVisit(studioId));
  const [dismissed, setDismissed] = useState(false);
  const summary =
    since === null || dismissed ? null : awaySummary(product, since, question);

  useEffect(() => {
    const save = () => writeLastVisit(studioId, Date.now());
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
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
          writeLastVisit(studioId, Date.now());
          setDismissed(true);
        }}
        className="mt-2 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
      >
        Got it
      </button>
    </section>
  );
}
