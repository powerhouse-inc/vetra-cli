/**
 * Temporary debug view of the Studio's product document (M0, Task 0.6),
 * shown behind `?debug=product`. Replaced by the step strip in M1.
 */
import { useDocumentSafe } from "@powerhousedao/reactor-browser";
import {
  isStudioProductDocument,
  normalizeProduct,
  type StudioProductState,
} from "document-models/studio-product";
import { useState } from "react";
import {
  findProductNode,
  type StartProductDrive,
} from "../idea/startProduct.js";

const DEBUG_PARAM = "debug";

/** True when the page URL asks for the product debug panel. */
export function isProductDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get(DEBUG_PARAM) === "product"
  );
}

/** A normalised copy of the product state; the hook's state stays untouched. */
export function readProductState(
  state: StudioProductState,
): StudioProductState {
  return normalizeProduct(structuredClone(state));
}

export function ProductDebugPanel({ drive }: { drive: StartProductDrive }) {
  const [open, setOpen] = useState(true);
  const node = findProductNode(drive);
  const result = useDocumentSafe(node?.id ?? null);
  const doc =
    result.status === "success" && isStudioProductDocument(result.data)
      ? result.data
      : undefined;
  const state = doc ? readProductState(doc.state.global) : undefined;
  const change = state?.changes.find((c) => c.id === state.activeChangeId);

  return (
    <section
      aria-label="Product document (debug)"
      className="absolute bottom-3 right-3 z-40 flex max-h-[70%] w-96 flex-col overflow-hidden rounded-lg border border-border bg-card text-xs shadow-lg"
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-semibold text-foreground">Product (debug)</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded px-1.5 text-muted-foreground hover:bg-accent"
        >
          {open ? "Hide" : "Show"}
        </button>
      </header>
      {open ? (
        <div className="min-h-0 overflow-y-auto px-3 py-2 text-foreground">
          {!node ? (
            <p className="text-muted-foreground">
              No product in this Studio yet.
            </p>
          ) : !state ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
              <p>
                <strong>{state.name ?? "(unnamed)"}</strong>
                {state.slug ? ` · ${state.slug}` : ""}
              </p>
              <p className="text-muted-foreground">{state.idea}</p>
              {change ? (
                <>
                  <p className="mt-2">
                    {change.kind} · {change.status}
                    {change.title ? ` · ${change.title}` : ""}
                  </p>
                  <ol className="mt-1 space-y-0.5">
                    {change.steps.map((s) => (
                      <li key={s.kind}>
                        {s.kind}: {s.status}
                        {s.total !== null && s.total !== undefined
                          ? ` (${s.done ?? 0}/${s.total})`
                          : ""}
                        {s.label ? ` — ${s.label}` : ""}
                        {s.reason ? ` — ${s.reason}` : ""}
                      </li>
                    ))}
                  </ol>
                  {change.milestones.length > 0 ? (
                    <ul className="mt-2 list-disc pl-4">
                      {change.milestones.map((m) => (
                        <li key={m.id}>{m.text}</li>
                      ))}
                    </ul>
                  ) : null}
                  {change.stuck ? (
                    <p className="mt-2 text-destructive">
                      Stuck: {change.stuck.reason}
                    </p>
                  ) : null}
                  <p className="mt-2 text-muted-foreground">
                    Check runs: {change.checkRuns.length}
                    {change.checkRuns.length > 0
                      ? ` · last: ${change.checkRuns[
                          change.checkRuns.length - 1
                        ].results
                          .map((r) => `${r.kind} ${r.passed ? "ok" : "failed"}`)
                          .join(", ")}`
                      : ""}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-muted-foreground">No active change.</p>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground">
                  Raw state
                </summary>
                <pre className="mt-1 whitespace-pre-wrap break-all">
                  {JSON.stringify(state, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
