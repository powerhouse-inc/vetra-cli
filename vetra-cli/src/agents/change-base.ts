/**
 * Change base (F19): before the model's first step of a turn, a new change
 * after launch gets the live version's code under it (`prepareChangeBase`),
 * so nothing the agent does in that change ever races the reset.
 *
 * - Runs at step 0 of every turn of the main agent; only a CHANGE or UNDO
 *   with no planned step that no git ref marks as prepared is touched, so a
 *   change is prepared at most once, across restarts.
 * - Never blocks the turn. When a turn goes on without the base (git failed,
 *   backing off, or the product couldn't be read), the change is marked
 *   `refs/vetra/change-unbased/<id>`: the agent's edits from then on stand and
 *   are never reverted; the change simply starts from the code that was there.
 * - A Bring them in change (changes.ts) also gets GitHub's `main` merged in;
 *   the note on what came in is added as a system message for the turn.
 * - Failures are logged once and retried no sooner than
 *   `CHANGE_BASE_RETRY_MS` (reads and git alike).
 */
import type { ProcessInputStepArgs, Processor } from '@mastra/core/processors';
import type { Change } from 'vetra-app/document-models/studio-product';
import { markChangeUnbased } from '../launch/git-versions.js';
import { activeChange, getProductDoc } from '../product/product-doc.js';
import {
  awaitsBase,
  bringInReminder,
  prepareChangeBase,
  type ChangeBaseContext,
} from '../product/changes.js';

/** How long after a failure the next turn tries again. */
export const CHANGE_BASE_RETRY_MS = 60_000;

const PROCESSOR_ID = 'change-base';
const TAG = '[change-base]';
/** System-message tag of the Bring them in note (kept for the turn's steps). */
export const BRING_IN_TAG = 'bring-in';

export interface ChangeBaseProcessorOptions {
  readProduct?: typeof getProductDoc;
  prepare?: typeof prepareChangeBase;
  markUnbased?: typeof markChangeUnbased;
  remind?: typeof bringInReminder;
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
  private readonly markUnbased: typeof markChangeUnbased;
  private readonly remind: typeof bringInReminder;
  private readonly now: () => number;
  /** Changes whose preparation failed: when, to back off. */
  private readonly failedAt = new Map<string, number>();
  /** When the product last couldn't be read (null: it could). */
  private readFailedAt: number | null = null;
  /** A turn went on without knowing the product (its change can't be reset later). */
  private blind = false;

  constructor(
    private readonly ctx: ChangeBaseContext,
    options: ChangeBaseProcessorOptions = {},
  ) {
    this.readProduct = options.readProduct ?? getProductDoc;
    this.prepare = options.prepare ?? prepareChangeBase;
    this.markUnbased = options.markUnbased ?? markChangeUnbased;
    this.remind = options.remind ?? bringInReminder;
    this.now = options.now ?? Date.now;
  }

  /** The turn goes on without the base: the change's code is never reset from now on. */
  private async goOnUnbased(change: Change): Promise<void> {
    try {
      await this.markUnbased(this.ctx.workdir, change.id);
    } catch (err) {
      this.ctx.log?.debug?.(`${TAG} couldn't mark change ${change.id}: ${message(err)}`);
    }
  }

  async processInputStep(args: ProcessInputStepArgs): Promise<undefined> {
    if (args.stepNumber !== 0) return undefined;
    if (this.readFailedAt !== null && this.now() - this.readFailedAt < CHANGE_BASE_RETRY_MS) {
      this.blind = true;
      return undefined;
    }
    let state;
    try {
      state = (await this.readProduct(this.ctx))?.state;
    } catch (err) {
      if (this.readFailedAt === null) {
        this.ctx.log?.warn?.(`${TAG} couldn't read the product document: ${message(err)}`);
      }
      this.readFailedAt = this.now();
      this.blind = true;
      return undefined;
    }
    this.readFailedAt = null;
    const change = state ? activeChange(state) : null;
    if (state && change && !awaitsBase(change)) {
      // A later turn of a Bring them in change: conflicts left are told again.
      try {
        const text = await this.remind(this.ctx, change);
        if (text) args.messageList?.addSystem(text, BRING_IN_TAG);
      } catch (err) {
        this.ctx.log?.debug?.(`${TAG} bring-in reminder skipped: ${message(err)}`);
      }
      return undefined;
    }
    if (!state || !change) return undefined;
    if (this.blind) {
      // An earlier turn may have worked on this change without its base.
      this.blind = false;
      await this.goOnUnbased(change);
    }
    const failed = this.failedAt.get(change.id);
    if (failed !== undefined && this.now() - failed < CHANGE_BASE_RETRY_MS) {
      await this.goOnUnbased(change);
      return undefined;
    }
    try {
      // Bring them in: what came from GitHub is told to the model for this turn.
      const notes: string[] = [];
      await this.prepare(this.ctx, change, { state, note: (text) => notes.push(text) });
      for (const text of notes) args.messageList?.addSystem(text, BRING_IN_TAG);
      this.failedAt.delete(change.id);
    } catch (err) {
      if (failed === undefined) {
        this.ctx.log?.warn?.(
          `${TAG} couldn't put the live code under change ${change.id}; it goes on from the code that is there: ${message(err)}`,
        );
      }
      this.failedAt.set(change.id, this.now());
      await this.goOnUnbased(change);
    }
    return undefined;
  }
}
