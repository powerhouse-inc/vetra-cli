import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { mapMastraStream } from '@powerhousedao/ph-clint/mastra';
import { StudioProductV1 } from 'vetra-app/document-models';
import { z } from 'zod';
import { PAUSED_REASON, PauseProcessor, agentLogger, isPauseAbortLog, isPaused } from '../../src/agents/pause.js';
import { productHarness, type ProductHarness } from '../product/helpers.js';

const a = StudioProductV1.actions;
const AT = '2026-10-20T10:05:00.000Z';

type StreamPart = Record<string, unknown>;

/**
 * A scripted model: each call answers with the next script entry — a call to
 * the `work` tool, or a closing text. Counts its calls.
 */
function scriptedModel(script: Array<'work' | 'done'>) {
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
  let calls = 0;
  const model = {
    specificationVersion: 'v2' as const,
    provider: 'test',
    modelId: 'scripted',
    supportedUrls: {},
    get calls() {
      return calls;
    },
    doGenerate() {
      throw new Error('not used');
    },
    doStream() {
      const next = script[Math.min(calls, script.length - 1)];
      calls++;
      const parts: StreamPart[] =
        next === 'work'
          ? [
              { type: 'stream-start', warnings: [] },
              { type: 'tool-call', toolCallId: `call-${calls}`, toolName: 'work', input: '{}' },
              { type: 'finish', finishReason: 'tool-calls', usage },
            ]
          : [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: 'done' },
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

/** Runs one turn of an agent with the pause processor; returns its chunks. */
async function runTurn(
  h: ProductHarness,
  model: ReturnType<typeof scriptedModel>,
  onWork: () => Promise<void>,
): Promise<{ raw: Array<{ type: string; payload?: Record<string, unknown> }>; mapped: Array<Record<string, unknown>> }> {
  const work = createTool({
    id: 'work',
    description: 'does one unit of work',
    inputSchema: z.object({}),
    execute: async () => {
      await onWork();
      return { ok: true };
    },
  });
  const agent = new Agent({
    id: 'pause-test',
    name: 'Pause test',
    instructions: 'test',
    model: model as never,
    tools: { work },
    inputProcessors: [new PauseProcessor(h.ctx, { graceMs: 0 })],
  });
  agent.__setLogger(agentLogger('Pause test'));
  const result = await agent.stream('build it', { maxSteps: 10 });
  const raw: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  async function* tap() {
    for await (const chunk of result.fullStream as AsyncIterable<{ type: string; payload?: Record<string, unknown> }>) {
      raw.push(chunk);
      yield chunk;
    }
  }
  const mapped: Array<Record<string, unknown>> = [];
  for await (const c of mapMastraStream(tap() as never)) mapped.push(c as Record<string, unknown>);
  return { raw, mapped };
}

describe('PauseProcessor', () => {
  let h: ProductHarness | undefined;
  afterEach(async () => {
    await h?.kill();
    h = undefined;
  });

  const pause = () => h!.module.client.execute(h!.productId!, 'main', [a.pauseChange({ changeId: 'change-1', at: AT })]);
  const resume = () =>
    h!.module.client.execute(h!.productId!, 'main', [a.resumeChange({ changeId: 'change-1', at: AT })]);

  it('pause stops after the current step, not mid-tool', async () => {
    h = await productHarness();
    const model = scriptedModel(['work', 'work', 'work', 'done']);
    const finished: number[] = [];
    // The customer presses Pause while the first tool call runs.
    const { raw } = await runTurn(h, model, async () => {
      if (finished.length === 0) await pause();
      finished.push(finished.length);
    });

    // The running tool call finished; no further model step ran.
    expect(finished).toEqual([0]);
    expect(model.calls).toBe(1);
    expect(raw.find((c) => c.type === 'tripwire')?.payload).toMatchObject({
      reason: PAUSED_REASON,
      processorId: 'pause',
    });
    // The processor writes no story line: the Studio shows the paused line
    // from the change's status (exactly once).
    const state = await h.state();
    expect(isPaused(state)).toBe(true);
    expect(state.changes[0].milestones).toEqual([]);
  }, 30_000);

  it('a paused turn is not reported as a failed turn', async () => {
    h = await productHarness();
    const model = scriptedModel(['work', 'done']);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    let raw: Awaited<ReturnType<typeof runTurn>>['raw'];
    let mapped: Awaited<ReturnType<typeof runTurn>>['mapped'];
    try {
      ({ raw, mapped } = await runTurn(h, model, pause));
      // Mastra's "Error executing step …processor:pause" line is dropped.
      expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('processor:pause'))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
    expect(raw.find((c) => c.type === 'tripwire')?.payload).toMatchObject({ reason: PAUSED_REASON });
    // What the chat bridge sees (ph-clint's mapping): no error chunk, so no
    // FAIL_TURN — the turn completes, its last message closed without a
    // finish reason (not the step cap's `tool-calls`, so the supervisor
    // doesn't continue it on its own).
    expect(mapped.filter((c) => c.type === 'error')).toEqual([]);
    expect(mapped.filter((c) => c.type === 'finish')).toEqual([]);
  }, 30_000);

  it('resume continues the same change', async () => {
    h = await productHarness();
    const first = scriptedModel(['work', 'done']);
    await runTurn(h, first, pause);
    expect(first.calls).toBe(1);

    // Continue: RESUME_CHANGE, then the `continue` turn.
    await resume();
    const second = scriptedModel(['work', 'done']);
    let worked = 0;
    const { raw } = await runTurn(h, second, async () => {
      worked++;
    });
    expect(raw.some((c) => c.type === 'tripwire')).toBe(false);
    expect(worked).toBe(1);
    expect(second.calls).toBe(2);
    const state = await h.state();
    expect(state.activeChangeId).toBe('change-1');
    expect(state.changes).toHaveLength(1);
    expect(state.changes[0].status).toBe('BUILDING');
  }, 30_000);

  it('a turn that starts on a paused change waits for the resume, then stops', async () => {
    h = await productHarness();
    await pause();
    const read = () => h!.module.client.get(h!.productId!).then((d) => ({ id: 'p', state: (d as { state: { global: never } }).state.global }));
    const sleeps: number[] = [];
    const abort = (reason?: string): never => {
      throw new Error(`abort:${reason}`);
    };
    const args = (stepNumber: number) => ({ stepNumber, abort }) as never;

    // RESUME_CHANGE arrives during the grace period: the turn runs.
    const resuming = new PauseProcessor(h.ctx, {
      readProduct: read,
      graceMs: 1000,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 2) await resume();
      },
    });
    await expect(resuming.processInputStep(args(0))).resolves.toBeUndefined();
    expect(sleeps).toHaveLength(2);

    // Still paused after the grace period: stopped.
    await pause();
    const waiting = new PauseProcessor(h.ctx, { readProduct: read, graceMs: 1000, sleep: async () => {} });
    await expect(waiting.processInputStep(args(0))).rejects.toThrow(`abort:${PAUSED_REASON}`);
    // Later steps stop at once.
    const noWait = new PauseProcessor(h.ctx, {
      readProduct: read,
      sleep: () => Promise.reject(new Error('should not wait')),
    });
    await expect(noWait.processInputStep(args(3))).rejects.toThrow(`abort:${PAUSED_REASON}`);
  }, 30_000);

  it('only the pause abort line is dropped from the agent log', () => {
    const line = (stepId: string, stack: string) => `Error executing step ${stepId}: ${stack}`;
    const step = 'workflow.vetra-agent-input-processor.step.processor:pause';
    expect(isPauseAbortLog({ level: 'error', message: line(step, 'Error: paused\n    at abort') })).toBe(true);
    expect(isPauseAbortLog({ level: 'error', message: line(step, 'Error: offline') })).toBe(false);
    expect(
      isPauseAbortLog({ level: 'error', message: line('workflow.x.step.processor:phase-tools', 'Error: paused') }),
    ).toBe(false);
    expect(isPauseAbortLog({ level: 'warn', message: line(step, 'Error: paused') })).toBe(false);
  });

  it('a product document that cannot be read never stops the turn', async () => {
    const warn: string[] = [];
    const p = new PauseProcessor(
      { log: { warn: (m) => warn.push(m) } },
      { readProduct: () => Promise.reject(new Error('offline')) },
    );
    await expect(p.processInputStep({ stepNumber: 2, abort: () => { throw new Error('aborted'); } } as never)).resolves.toBeUndefined();
    expect(warn[0]).toMatch(/offline/);
    expect(isPaused(null)).toBe(false);
  });
});
