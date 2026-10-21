/**
 * Pause through the real chat watcher (clint-common's chat-session-watch):
 * a message the customer sends while the change is paused starts a turn that
 * the PauseProcessor stops at its first step; it is not retried while paused,
 * and Continue (RESUME_CHANGE + `continue`) answers it — it leads the
 * `continue` turn's prompt, once.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { ReactorBuilder, ReactorClientBuilder, type ReactorClientModule } from '@powerhousedao/reactor';
import { driveDocumentModelModule } from '@powerhousedao/shared/document-drive';
import {
  STEER_THREAD_KEY,
  chatSessionWatchTrigger,
  createSteerProcessor,
  hasInFlightTurn,
} from '@powerhousedao/clint-common/chat';
import {
  ChatSession,
  type ChatSessionState,
} from '@powerhousedao/clint-common/document-models/chat-session';
import { mapMastraStream } from '@powerhousedao/ph-clint/mastra';
import { withSignaturePolicy } from 'document-model';
import { StudioProductV1 } from 'vetra-app/document-models';
import type { StudioProductState } from 'vetra-app/document-models/studio-product';
import { PauseProcessor } from '../../src/agents/pause.js';
import type { ProductContext } from '../../src/product/product-doc.js';

const a = StudioProductV1.actions;
const chat = ChatSession.actions;
const AT = '2026-10-20T10:00:00.000Z';
const M = 'make the cards blue';

type StreamPart = Record<string, unknown>;

/** A model that answers every call with a short text; counts its calls. */
function textModel() {
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
  const model = {
    specificationVersion: 'v2' as const,
    provider: 'test',
    modelId: 'text',
    supportedUrls: {},
    calls: 0,
    doGenerate() {
      throw new Error('not used');
    },
    doStream() {
      model.calls++;
      const parts: StreamPart[] = [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'On it.' },
        { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: 'stop', usage },
      ];
      return Promise.resolve({
        stream: new ReadableStream<StreamPart>({
          start(c) {
            for (const p of parts) c.enqueue(p);
            c.close();
          },
        }),
      });
    },
  };
  return model;
}

function promptText(prompt: unknown): string {
  if (typeof prompt === 'string') return prompt;
  return (prompt as Array<{ type: string; text?: string }>)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');
}

describe('pause through the chat watcher', () => {
  let module: ReactorClientModule;
  let productId: string;
  let sessionId: string;
  const prompts: string[] = [];
  const model = textModel();
  let trigger: { poll(ctx: unknown): Promise<unknown> };
  let triggerCtx: Record<string, unknown>;

  const product = async () =>
    ((await module.client.get(productId)) as { state: { global: StudioProductState } }).state.global;
  const session = async () =>
    ((await module.client.get(sessionId)) as { state: { global: ChatSessionState } }).state.global;
  const send = (text: string, id = randomUUID()) =>
    module.client.execute(sessionId, 'main', [
      chat.addUserMessage({ id, createdAt: new Date().toISOString(), content: [{ id: randomUUID(), type: 'TEXT', text }] }),
    ]);

  /** One watcher pass, then wait until the turns it started have ended. */
  async function poll() {
    (triggerCtx.state as { pending: number }).pending = 1;
    await trigger.poll(triggerCtx);
    const threadId = (await session()).threadId;
    for (let i = 0; i < 200 && threadId && hasInFlightTurn(threadId); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  beforeAll(async () => {
    const builder = new ReactorBuilder().withDocumentModelSources([
      driveDocumentModelModule as never,
      StudioProductV1 as never,
      ChatSession as never,
    ]);
    module = await new ReactorClientBuilder().withReactorBuilder(builder).withCreateSignaturePolicy('legacy').buildModule();
    const drive = await module.client.createEmpty('powerhouse/document-drive');
    const driveId = drive.header.id;
    const productCtx: ProductContext = {
      folders: {},
      reactor: async () => ({ client: module.client, personalDriveId: driveId, driveId }),
    };

    productId = (
      await module.client.createDocumentInDrive(
        driveId,
        withSignaturePolicy(StudioProductV1.utils.createDocument(), 'legacy'),
      )
    ).header.id;
    await module.client.execute(productId, 'main', [
      a.initProduct({ name: 'Task board', idea: 'a task board for my team', createdAt: AT }),
      a.startChange({ id: 'change-1', kind: 'FIRST_BUILD', request: 'a task board', startedAt: AT }),
    ]);
    sessionId = (
      await module.client.createDocumentInDrive(driveId, withSignaturePolicy(ChatSession.utils.createDocument(), 'legacy'))
    ).header.id;

    const agent = new Agent({
      id: 'vetra-agent',
      name: 'Vetra Agent',
      instructions: 'test',
      model: model as never,
      inputProcessors: [new PauseProcessor(productCtx, { graceMs: 0 }), createSteerProcessor()],
    });
    const provider = {
      id: 'vetra-agent',
      name: 'Vetra Agent',
      async *stream(prompt: unknown, opts?: { threadId?: string; abortSignal?: AbortSignal }) {
        prompts.push(promptText(prompt));
        const requestContext = new RequestContext();
        if (opts?.threadId) requestContext.set(STEER_THREAD_KEY, opts.threadId);
        const result = await agent.stream(prompt as string, { requestContext, abortSignal: opts?.abortSignal });
        yield* mapMastraStream(result.fullStream as never);
      },
    };
    trigger = chatSessionWatchTrigger;
    triggerCtx = {
      state: { pending: 0 },
      reactor: async () => ({ client: module.client }),
      agent: async () => provider,
      context: {},
    };
    // First pass: the watcher starts the session (thread id).
    await poll();
    if (!(await session()).threadId) throw new Error('the watcher did not start the session');
  }, 60_000);

  afterAll(async () => {
    await module.reactor.kill().completed;
  });

  it('a message sent while paused leads the Continue turn, once', async () => {
    // A first turn while building.
    await send('a task board');
    await poll();
    expect(prompts).toEqual(['a task board']);
    expect(model.calls).toBe(1);

    // Pause; the customer sends M: its turn stops at the first step.
    await module.client.execute(productId, 'main', [a.pauseChange({ changeId: 'change-1', at: AT })]);
    await send(M);
    await poll();
    expect(prompts).toEqual(['a task board', M]);
    expect(model.calls).toBe(1);
    const stopped = (await session()).messages;
    expect(stopped.at(-1)).toMatchObject({ role: 'USER' });

    // Nothing starts M again while paused.
    await poll();
    await poll();
    expect(prompts).toHaveLength(2);
    expect((await session()).messages).toHaveLength(stopped.length);

    // Continue: RESUME_CHANGE, then `continue`.
    await module.client.execute(productId, 'main', [a.resumeChange({ changeId: 'change-1', at: AT })]);
    await send('continue', `studio-continue-${randomUUID()}`);
    await poll();
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toBe(`${M}\n\ncontinue`);
    expect(prompts[2].split(M)).toHaveLength(2);
    expect(model.calls).toBe(2);
    expect((await product()).changes[0].status).toBe('BUILDING');
    const last = (await session()).messages.at(-1);
    expect(last).toMatchObject({ role: 'ASSISTANT', finishReason: 'stop' });

    // Nothing more runs.
    await poll();
    expect(prompts).toHaveLength(3);
  }, 60_000);
});
