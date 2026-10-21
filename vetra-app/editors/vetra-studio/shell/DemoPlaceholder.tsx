import type { ReactNode } from "react";

/**
 * Demo mode until Task 2.4's DemoLayout lands: the product fills the page,
 * the story is out of view, and the steer box stays at the bottom with the
 * agent's pending question over it (answering it there is a steer).
 */
export function DemoPlaceholder({
  product,
  steer,
  question,
}: {
  product: ReactNode;
  /** The steer box (or the next-change box); null when there is none. */
  steer: ReactNode | null;
  /** The agent's open question, if any. */
  question: string | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        data-demo-product
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      >
        {product}
      </div>
      {question || steer ? (
        <div className="shrink-0 border-t border-border bg-card">
          {question ? (
            <p
              data-demo-question
              className="whitespace-pre-wrap border-b border-vetra-primary/40 bg-vetra-primary/5 px-4 py-2 text-sm text-foreground"
            >
              {question}
            </p>
          ) : null}
          {steer}
        </div>
      ) : null}
    </div>
  );
}
