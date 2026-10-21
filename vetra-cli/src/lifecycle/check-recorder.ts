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
 * recorded. A check run is stamped with the time its tool call started (a
 * GENERATE run with the time it finished), so the TESTS gate's freshness rule
 * holds when tool calls overlap. Runs are only recorded on a change that can still be worked on;
 * otherwise they are skipped silently. A failure to write the product document
 * is logged and never changes the tool's outcome.
 *
 * Lifecycle hooks get no command context, so the reactor is reached through
 * the context the agent was created with (`bindRecorderContext`, called from
 * `createAgent`) — only agent tool calls pass through this wrap anyway.
 */
import { randomUUID } from "node:crypto";
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import { capReason, readCheckResults, type ObservedCheck } from "../product/check-results.js";
import {
  IN_PROGRESS,
  activeChange,
  dispatchProduct,
  getProductDoc,
  productActions,
  type ProductContext,
} from "../product/product-doc.js";

export const RECORDED_TOOLS = new Set(["spec-generate", "reactor-project-check"]);

/* A stalled reactor must not hang the tool call. */
const RECORD_TIMEOUT_MS = 10_000;

let boundContext: ProductContext | undefined;

/** Called once the agent's command context exists. */
export function bindRecorderContext(ctx: ProductContext | undefined): void {
  boundContext = ctx;
}

/**
 * Record one check run, stamped `at`, on the active change; never throws.
 * Only kind/passed and a customer-safe reason are stored (`detail` is the
 * agent's). Gives up after `timeoutMs`.
 */
export async function recordCheckRun(
  ctx: ProductContext | undefined,
  results: ObservedCheck[],
  at: string,
  log?: { warn?: (msg: string) => void },
  timeoutMs = RECORD_TIMEOUT_MS,
): Promise<void> {
  if (!ctx || results.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const record = async () => {
      const product = await getProductDoc(ctx);
      const change = product ? activeChange(product.state) : null;
      if (!change || !IN_PROGRESS.includes(change.status)) return;
      await dispatchProduct(ctx, [
        productActions.recordCheckRun({
          changeId: change.id,
          id: randomUUID(),
          at,
          results: results.map((r) => ({
            kind: r.kind,
            passed: r.passed,
            reason: r.reason ? capReason(r.reason) : null,
          })),
        }),
      ]);
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    await Promise.race([record(), timeout]);
  } catch (err) {
    log?.warn?.(
      `[check-recorder] could not record ${results.map((r) => r.kind).join(", ")}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function checkRecorder(
  opts: {
    context?: () => ProductContext | undefined;
    now?: () => Date;
    timeoutMs?: number;
  } = {},
): LifecycleHook {
  const getContext = opts.context ?? (() => boundContext);
  const now = opts.now ?? (() => new Date());
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
                // Freshness (TESTS gate): a check run is as old as the code it
                // looked at, so checks are stamped when they START — a check
                // that began before a concurrent spec-generate finished must
                // not count as newer than it. GENERATE is stamped when it
                // finishes, i.e. when the new code exists.
                const startedAt = now().toISOString();
                const record = (value: unknown) => {
                  const observed = readCheckResults(value);
                  if (!observed) return Promise.resolve();
                  const at = name === "spec-generate" ? now().toISOString() : startedAt;
                  return recordCheckRun(getContext(), observed, at, init.log, opts.timeoutMs);
                };
                let result: unknown;
                try {
                  result = await innerExecute(...args);
                } catch (err) {
                  await record(err);
                  throw err;
                }
                await record(result);
                return result;
              },
            };
          },
        },
      };
    },
  };
}
