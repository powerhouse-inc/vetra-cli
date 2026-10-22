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
 * - Mastra logs every processor abort as "Error executing step …"; the main
 *   agent's logger (`agentLogger`) drops that line for a pause.
 */
import { randomUUID } from 'node:crypto';
import type { ISigner } from '@powerhousedao/shared/document-model';
import { ConsoleLogger, type LogLevel } from '@mastra/core/logger';
import { prepareSignedActions } from '@powerhousedao/reactor-browser';
import type { ProcessInputStepArgs, Processor } from '@mastra/core/processors';
import { StudioProductV1 } from 'vetra-app/document-models';
import type {
  Change,
  StudioProductState,
} from 'vetra-app/document-models/studio-product';
import {
  activeChange,
  getProductDoc,
  productActions as a,
  type ProductContext,
} from '../product/product-doc.js';
import { productLocation } from '../product/product-location.js';
import {
  changeAccess,
  studioMemberSigner,
  type ChangeAccess,
  type ChangeOwnerContext,
} from '../team/change-owner.js';

/** The reason a paused turn is aborted with (F16). */
export const PAUSED_REASON = 'paused';

/**
 * How long a turn that starts on a PAUSED change waits for RESUME_CHANGE to
 * arrive: Continue sends RESUME_CHANGE and `continue` together, and the two
 * documents may reach the agent in either order.
 */
export const RESUME_GRACE_MS = 3_000;
const RESUME_POLL_MS = 250;

const PROCESSOR_ID = 'pause';

/**
 * Whether a Mastra log line is the workflow engine reporting this
 * processor's pause abort as a failed step (it is not an error).
 */
export function isPauseAbortLog(entry: { level: LogLevel; message: string }): boolean {
  return (
    entry.level === 'error' &&
    entry.message.startsWith('Error executing step ') &&
    new RegExp(`processor:${PROCESSOR_ID}: \\w*Error: ${PAUSED_REASON}\\b`).test(entry.message)
  );
}

/**
 * The main agent's logger: Mastra's default console logger (error level),
 * without the pause abort's "Error executing step" line. Kept through
 * `child()`, so the processor workflow's logger filters too.
 */
export function agentLogger(name: string): ConsoleLogger {
  return new ConsoleLogger({ name, filter: (entry) => !isPauseAbortLog(entry) });
}

/** Whether the active change of `state` is PAUSED. */
export function isPaused(state: StudioProductState | null | undefined): boolean {
  if (!state?.activeChangeId) return false;
  return state.changes.find((c) => c.id === state.activeChangeId)?.status === 'PAUSED';
}

/**
 * P6-4, task 1.11: a change whose owner was removed (or who never allowed the
 * agent) cannot be worked on. The plain milestone text the Studio shows.
 */
export function accessPauseText(name: string, removed: boolean): string {
  return removed
    ? `Paused — ${name} no longer has access`
    : `Waiting for ${name} to allow the Studio's agent to work for them`;
}

/** The context an access pause needs: an org Studio's workdir and config. */
export interface AccessPauseContext extends ProductContext {
  workdir: string;
  config: { studioOrgId?: string; environmentId?: string; cloudRenownUrl?: string; renownOrgsUrl?: string };
}

/**
 * Pause `changeId` for an access decision and record why (PAUSE_CHANGE +
 * milestone). Signed by another admitted member's delegation — never by the
 * member being removed. Returns false when no such delegation exists (nothing
 * is written; the write path still refuses the change).
 */
export async function pauseForAccess(
  ctx: AccessPauseContext,
  changeId: string,
  access: Extract<ChangeAccess, { kind: 'removed' | 'no-delegation' }>,
  deps: { signer?: (owner: ChangeOwnerContext) => Promise<ISigner | null> } = {},
): Promise<boolean> {
  const location = await productLocation(ctx);
  if (!location) return false;
  const owner = {
    workdir: ctx.workdir,
    config: ctx.config,
    reactor: ctx.reactor,
    folders: ctx.folders,
    log: ctx.log,
    ownerDeps: ctx.changeOwnerDeps,
  };
  const signer = await (deps.signer ?? studioMemberSigner)(owner);
  if (!signer) {
    ctx.log?.warn?.(
      `[pause] change ${changeId} needs an access pause but no other member has allowed the agent`,
    );
    return false;
  }
  const at = new Date().toISOString();
  const name = access.owner.name?.trim() || access.owner.address;
  const actions = [
    a.pauseChange({ changeId, at }),
    a.addMilestone({
      changeId,
      id: randomUUID(),
      text: accessPauseText(name, access.kind === 'removed'),
      at,
    }),
  ];
  const snapshot = await location.client.get(location.id);
  const signed = await prepareSignedActions(
    actions,
    snapshot as Parameters<typeof prepareSignedActions>[1],
    signer,
    StudioProductV1,
  );
  await location.client.execute(location.id, 'main', signed);
  return true;
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
  readonly id = PROCESSOR_ID;
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

  /**
   * An org Studio's change whose owner can no longer sign for it: pause it and
   * stop the turn. `true` means the change is paused for access (abort).
   */
  private async accessRevoked(): Promise<boolean> {
    const ctx = this.ctx as AccessPauseContext;
    if (!ctx.config?.studioOrgId || !ctx.workdir) return false;
    try {
      const doc = await this.readProduct(ctx);
      const change = doc?.state ? activeChange(doc.state) : null;
      if (!change || change.status === 'PAUSED' || change.status === 'CLOSED') {
        return change?.status === 'PAUSED';
      }
      const access = await changeAccess(
        {
          workdir: ctx.workdir,
          config: ctx.config,
          reactor: ctx.reactor,
          folders: ctx.folders,
          log: ctx.log,
          ownerDeps: ctx.changeOwnerDeps,
        },
        change as Change,
      );
      if (access.kind !== 'removed' && access.kind !== 'no-delegation') return false;
      return await pauseForAccess(ctx, change.id, access);
    } catch (err) {
      ctx.log?.warn?.(
        `[pause] access check failed — not pausing: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
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
    if (await this.accessRevoked()) {
      this.ctx.log?.debug?.(`[pause] change paused for access — stopping before step ${args.stepNumber}`);
      return args.abort(PAUSED_REASON);
    }
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
