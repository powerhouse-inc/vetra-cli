import {
  useDispatch,
  useDocumentSafe,
  type DocumentDispatch,
} from "@powerhousedao/reactor-browser";
import type { Action, PHDocument } from "document-model";
import type { ReactNode } from "react";

type SafeState = ReturnType<typeof useDocumentSafe>;
type ErrorState = Extract<SafeState, { status: "error" }>;

/**
 * Resolve a document by id without suspending or throwing, narrowed to a
 * concrete type via its guard. `useDocumentSafe` subscribes to cache updates,
 * so a just-created document resolves in place — no error/suspension escapes
 * to a parent boundary, so the surrounding view never blanks.
 */
export function useSafeDocument<TDoc extends PHDocument>(
  id: string | null | undefined,
  guard: (doc: unknown) => doc is TDoc,
): {
  state: SafeState;
  document: TDoc | undefined;
  dispatch: DocumentDispatch<Action>;
} {
  const state = useDocumentSafe(id);
  const document =
    state.status === "success" && guard(state.data) ? state.data : undefined;
  const [, dispatch] = useDispatch(document);
  return { state, document, dispatch } as const;
}

function DefaultPending() {
  return (
    <div className="p-6 text-sm text-muted-foreground">Loading document…</div>
  );
}

function DefaultError({ state }: { state: ErrorState }) {
  return (
    <div className="p-6 text-sm text-muted-foreground">
      Couldn't load this document.{" "}
      <button
        type="button"
        className="underline hover:text-foreground"
        onClick={() => state.reload?.()}
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Renders `children` with the loaded, type-narrowed document and its dispatch.
 * While the document is resolving (or stale) it renders a placeholder instead
 * — overridable via `pending` / `error` for callers with their own states.
 */
export function SafeDocument<TDoc extends PHDocument>({
  id,
  guard,
  children,
  pending,
  error,
}: {
  id: string | null | undefined;
  guard: (doc: unknown) => doc is TDoc;
  children: (args: {
    document: TDoc;
    dispatch: DocumentDispatch<Action>;
  }) => ReactNode;
  pending?: (state: SafeState) => ReactNode;
  error?: (state: ErrorState) => ReactNode;
}) {
  const { state, document, dispatch } = useSafeDocument(id, guard);
  if (!document) {
    if (state.status === "error") {
      return <>{error ? error(state) : <DefaultError state={state} />}</>;
    }
    return <>{pending ? pending(state) : <DefaultPending />}</>;
  }
  return <>{children({ document, dispatch })}</>;
}
