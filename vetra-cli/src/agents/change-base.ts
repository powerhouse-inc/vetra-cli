/**
 * Change base (F19): before the model's first step of a turn, a new change
 * after launch gets the live version's code under it (`prepareChangeBase`),
 * so nothing the agent does in that change ever races the reset.
 *
 * - Runs at step 0 of every turn of the main agent; only a CHANGE or UNDO
 *   with no planned step that no git ref marks as prepared is touched, so a
 *   change is prepared at most once, across restarts.
 * - Never blocks the turn: a product document that can't be read is ignored;
 *   a git failure is logged once per change and retried by a later turn after
 *   `CHANGE_BASE_RETRY_MS`.
 */
import type { ProcessInputStepArgs, Processor } from '@mastra/core/processors';
import { activeChange, getProductDoc } from '../product/product-doc.js';
import { awaitsBase, prepareChangeBase, type ChangeBaseContext } from '../product/changes.js';

/** How long after a failed preparation the next turn tries again. */
export const CHANGE_BASE_RETRY_MS = 60_000;

const PROCESSOR_ID = 'change-base';

export interface ChangeBaseProcessorOptions {
  readProduct?: typeof getProductDoc;
  prepare?: typeof prepareChangeBase;
  now?: () => number;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ChangeBaseProcessor implements Processor<'change-base'> {
  readonly id = PROCESSOR_ID;
  readonly name = 'Change base';
  private readonly readProduct: typeof getProductDoc;
  private readonly prepare: typeof prepareChangeBase;
  private readonly now: () => number;
  /** Changes whose preparation failed: when, to back off. */
  private readonly failedAt = new Map<string, number>();

  constructor(
    private readonly ctx: ChangeBaseContext,
    options: ChangeBaseProcessorOptions = {},
  ) {
    this.readProduct = options.readProduct ?? getProductDoc;
    this.prepare = options.prepare ?? prepareChangeBase;
    this.now = options.now ?? Date.now;
  }

  async processInputStep(args: ProcessInputStepArgs): Promise<undefined> {
    if (args.stepNumber !== 0) return undefined;
    let state;
    try {
      state = (await this.readProduct(this.ctx))?.state;
    } catch (err) {
      this.ctx.log?.debug?.(`[change-base] couldn't read the product document: ${message(err)}`);
      return undefined;
    }
    const change = state ? activeChange(state) : null;
    if (!state || !change || !awaitsBase(change)) return undefined;
    const failed = this.failedAt.get(change.id);
    if (failed !== undefined && this.now() - failed < CHANGE_BASE_RETRY_MS) return undefined;
    try {
      await this.prepare(this.ctx, change, { state });
      this.failedAt.delete(change.id);
    } catch (err) {
      if (failed === undefined) {
        this.ctx.log?.warn?.(
          `[change-base] couldn't put the live code under change ${change.id}; trying again later: ${message(err)}`,
        );
      }
      this.failedAt.set(change.id, this.now());
    }
    return undefined;
  }
}
