import type { PHDocument } from "document-model";
import { useMemo, useState } from "react";
import { plainModel, type ModelSpec, type PlainModel } from "./plainModel.js";

export const DOCUMENT_MODEL_TYPE = "powerhouse/document-model";

function modelSpecOf(doc: PHDocument): { key: object; spec: ModelSpec } {
  const global = (doc.state as { global?: unknown }).global;
  return global && typeof global === "object"
    ? { key: global, spec: global }
    : { key: doc, spec: {} };
}

/* One parse per model revision: a document's global state is a new object
 * after each change to it, and the same object otherwise. */
const parsed = new WeakMap<object, PlainModel>();

/** The plain-words view of each model document (memoised per revision). */
export function plainModels(
  documents: readonly PHDocument[],
): { id: string; model: PlainModel }[] {
  return documents
    .filter((d) => d.header.documentType === DOCUMENT_MODEL_TYPE)
    .map((d) => {
      const { key, spec } = modelSpecOf(d);
      let model = parsed.get(key);
      if (!model) {
        model = plainModel(spec);
        parsed.set(key, model);
      }
      return { id: d.header.id, model };
    });
}

/**
 * Data step detail (spec §5.2): each data model in plain words, what you can
 * do with it, and its schema behind "Show schema".
 */
export function DataDetail({
  documents,
}: {
  /** The drive's documents; only data models are read. */
  documents: readonly PHDocument[];
}) {
  const models = useMemo(() => plainModels(documents), [documents]);
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
