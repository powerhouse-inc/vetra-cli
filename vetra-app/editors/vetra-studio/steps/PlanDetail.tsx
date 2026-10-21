import { useState } from "react";
import { DocumentHost } from "../ideation/DocumentHost.js";
import type { OpenTarget } from "../ideation/types.js";
import type { PlanBrief } from "./planBrief.js";

/**
 * Plan step detail (spec §5.2): the brief — idea, problem, audience and the
 * feature list — read-only, with "Edit" opening the document itself.
 */
export function PlanDetail({
  idea,
  brief,
}: {
  idea: string | null;
  brief: PlanBrief;
}) {
  const [editing, setEditing] = useState<OpenTarget | null>(null);

  if (editing) {
    return (
      <section aria-label="Edit plan" className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-foreground">
            {editing.name}
          </h2>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="ml-auto rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
          >
            Done
          </button>
        </div>
        <DocumentHost id={editing.id} documentType={editing.documentType} />
      </section>
    );
  }

  const empty =
    !brief.problem &&
    brief.audience.length === 0 &&
    brief.features.length === 0;

  return (
    <section aria-label="Plan" className="flex flex-col gap-6">
      {idea ? (
        <blockquote className="rounded-lg bg-accent px-4 py-3 text-sm text-foreground">
          “{idea}”
        </blockquote>
      ) : null}
      {empty ? (
        <p className="text-sm text-muted-foreground">
          The plan appears here as soon as it is written.
        </p>
      ) : null}
      {brief.problem ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            Problem
          </h3>
          <p className="text-sm text-foreground">{brief.problem}</p>
        </div>
      ) : null}
      {brief.audience.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            Who it&apos;s for
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {brief.audience.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{a.name}</span>
                {a.description ? ` — ${a.description}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {brief.features.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            Features
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {brief.features.map((f) => (
              <li key={f.id}>
                <span className="font-medium">{f.name}</span>
                {f.summary ? ` — ${f.summary}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {brief.documents.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {brief.documents.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setEditing(d)}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
            >
              Edit {d.name}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
