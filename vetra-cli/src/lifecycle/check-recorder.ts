/**
 * Records the check runs the agent's tools actually performed into the active
 * change of the product document, so the step gates (DATA, EDITORS, TESTS)
 * are judged on real outcomes, never on the agent's word.
 *
 *   - `spec-generate`          → GENERATE
 *   - `reactor-project-check`  → TYPECHECK + LINT, plus REDUCER_TESTS + SMOKE
 *                                with `tests: true` (a skipped kind is omitted)
 *
 * One tool call = one RECORD_CHECK_RUN. The commands attach what they observed
 * (`attachCheckResults`) to their result or thrown error; a call that never ran
 * a check (bad input, project not found) attaches nothing and nothing is
 * recorded. Runs are only recorded on a change that can still be worked on;
 * otherwise they are skipped silently. A failure to write the product document
 * is logged and never changes the tool's outcome.
 *
 * Lifecycle hooks get no command context, so the reactor is reached through
 * the context the agent was created with (`bindRecorderContext`, called from
 * `createAgent`) — only agent tool calls pass through this wrap anyway.
 */
import { randomUUID } from "node:crypto";
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import { readCheckResults, type ObservedCheck } from "../product/check-results.js";
import {
  IN_PROGRESS,
  activeChange,
  dispatchProduct,
  getProductDoc,
  productActions,
  type ProductContext,
} from "../product/product-doc.js";

export const RECORDED_TOOLS = new Set(["spec-generate", "reactor-project-check"]);

let boundContext: ProductContext | undefined;

/** Called once the agent's command context exists. */
export function bindRecorderContext(ctx: ProductContext | undefined): void {
  boundContext = ctx;
}

/** Record one check run on the active change; never throws. */
export async function recordCheckRun(
  ctx: ProductContext | undefined,
  results: ObservedCheck[],
  log?: { warn?: (msg: string) => void },
): Promise<void> {
  if (!ctx || results.length === 0) return;
  try {
    const product = await getProductDoc(ctx);
    const change = product ? activeChange(product.state) : null;
    if (!change || !IN_PROGRESS.includes(change.status)) return;
    await dispatchProduct(ctx, [
      productActions.recordCheckRun({
        changeId: change.id,
        id: randomUUID(),
        at: new Date().toISOString(),
        results,
      }),
    ]);
  } catch (err) {
    log?.warn?.(
      `[check-recorder] could not record ${results.map((r) => r.kind).join(", ")}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function checkRecorder(
  opts: { context?: () => ProductContext | undefined } = {},
): LifecycleHook {
  const getContext = opts.context ?? (() => boundContext);
  return {
    name: "check-recorder",
    onInit(init) {
      return {
        contribute: {
          tool(name, tool) {
            if (!RECORDED_TOOLS.has(name)) return tool;
            const innerExecute = tool.execute.bind(tool);
            return {
              ...tool,
              // Mastra calls execute(args, toolContext) — forward every arg.
              execute: async (...args: unknown[]) => {
                let result: unknown;
                try {
                  result = await innerExecute(...args);
                } catch (err) {
                  const observed = readCheckResults(err);
                  if (observed) await recordCheckRun(getContext(), observed, init.log);
                  throw err;
                }
                const observed = readCheckResults(result);
                if (observed) await recordCheckRun(getContext(), observed, init.log);
                return result;
              },
            };
          },
        },
      };
    },
  };
}
