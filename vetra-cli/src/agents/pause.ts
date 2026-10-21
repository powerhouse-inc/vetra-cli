/**
 * Pause (spec §5.4 "Stop"): the customer's Pause marks the active change
 * PAUSED (PAUSE_CHANGE, from the Studio); the running turn stops at its next
 * step boundary — never mid-tool, the step's tools have finished by then.
 * Continue is the Studio's RESUME_CHANGE plus the message `continue`, which
 * starts a new turn on the same change.
 *
 * - The abort carries the reason `paused` (F16): Mastra ends the stream with a
 *   tripwire, not an error, so the chat records no failed turn; the turn's
 *   last message closes without a finish reason (not the step cap's, so the
 *   supervisor doesn't continue it on its own).
 * - The story line "Paused — nothing is lost. Continue when you're ready." is
 *   the Studio's own paused line, shown from the change's PAUSED status; the
 *   processor writes no milestone, so the line appears exactly once.
 * - Runs first among the main agent's input processors (F17b), so steers
 *   queued for a turn that is about to stop stay queued for the next turn.
 * - A product document that can't be read never stops the turn (logged).
 */
import type { ProcessInputStepArgs, Processor } from '@mastra/core/processors';
import type { StudioProductState } from 'vetra-app/document-models/studio-product';
import { getProductDoc, type ProductContext } from '../product/product-doc.js';

/** The reason a paused turn is aborted with (F16). */
export const PAUSED_REASON = 'paused';

/**
 * How long a turn that starts on a PAUSED change waits for RESUME_CHANGE to
 * arrive: Continue sends RESUME_CHANGE and `continue` together, and the two
 * documents may reach the agent in either order.
 */
export const RESUME_GRACE_MS = 3_000;
const RESUME_POLL_MS = 250;

/** Whether the active change of `state` is PAUSED. */
export function isPaused(state: StudioProductState | null | undefined): boolean {
  if (!state?.activeChangeId) return false;
  return state.changes.find((c) => c.id === state.activeChangeId)?.status === 'PAUSED';
}

export interface PauseProcessorOptions {
  readProduct?: typeof getProductDoc;
  /** Overrides RESUME_GRACE_MS (tests). */
  graceMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mastra input processor: before every step of the main agent's loop, stops
 * the turn when the active change is PAUSED.
 */
export class PauseProcessor implements Processor<'pause'> {
  readonly id = 'pause';
  readonly name = 'Pause';
  private readonly readProduct: typeof getProductDoc;
  private readonly graceMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly ctx: ProductContext,
    options: PauseProcessorOptions = {},
  ) {
    this.readProduct = options.readProduct ?? getProductDoc;
    this.graceMs = options.graceMs ?? RESUME_GRACE_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private async paused(): Promise<boolean> {
    try {
      const doc = await this.readProduct(this.ctx);
      return isPaused(doc?.state);
    } catch (err) {
      this.ctx.log?.warn?.(
        `[pause] couldn't read the product document — not pausing: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  async processInputStep(args: ProcessInputStepArgs): Promise<undefined> {
    if (!(await this.paused())) return undefined;
    if (args.stepNumber === 0) {
      // A new turn on a PAUSED change: give a Continue's RESUME_CHANGE time
      // to arrive before stopping it.
      for (let waited = 0; waited < this.graceMs; waited += RESUME_POLL_MS) {
        await this.sleep(RESUME_POLL_MS);
        if (!(await this.paused())) return undefined;
      }
    }
    this.ctx.log?.debug?.(`[pause] change paused — stopping before step ${args.stepNumber}`);
    return args.abort(PAUSED_REASON);
  }
}
