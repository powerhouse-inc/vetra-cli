import { useState } from "react";
import type { PlainModel } from "./plainModel.js";

/**
 * Data step detail (spec §5.2): each data model in plain words, what you can
 * do with it, and its schema behind "Show schema".
 */
export function DataDetail({
  models,
}: {
  models: readonly { id: string; model: PlainModel }[];
}) {
  if (models.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The data appears here as soon as it is designed.
      </p>
    );
  }
  return (
    <section aria-label="Data" className="flex flex-col gap-4">
      {models.map(({ id, model }) => (
        <ModelCard key={id} model={model} />
      ))}
    </section>
  );
}

function ModelCard({ model }: { model: PlainModel }) {
  const [showSchema, setShowSchema] = useState(false);
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        {model.name}
      </h3>
      {model.sentences.map((s) => (
        <p key={s} className="text-sm text-foreground">
          {s}.
        </p>
      ))}
      {model.verbs.length > 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          You can: {model.verbs.join(", ")}.
        </p>
      ) : null}
      {model.schema ? (
        <>
          <button
            type="button"
            aria-expanded={showSchema}
            onClick={() => setShowSchema((v) => !v)}
            className="mt-3 text-xs font-medium text-vetra-primary hover:underline"
          >
            {showSchema ? "Hide schema" : "Show schema"}
          </button>
          {showSchema ? (
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-accent p-3 text-xs text-foreground">
              {model.schema}
            </pre>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
