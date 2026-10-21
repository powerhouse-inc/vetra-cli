import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ProcessInputStepArgs } from '@mastra/core/processors';
import { LocalFilesystem, LocalSandbox, Workspace, createSkillTools, createWorkspaceTools } from '@mastra/core/workspace';
import {
  ADVANCED_ONLY,
  ALWAYS_ON,
  PHASE_TOOLS,
  PhaseToolsProcessor,
  matchesAny,
} from '../../src/agents/phase-tools.js';
import { runProgress } from '../../src/commands/product/progress.js';
import { PUSH_OFF_FOR_PRODUCT, githubPush } from '../../src/commands/github/push.js';
import type { getProductDoc } from '../../src/product/product-doc.js';
import { productHarness, type ProductHarness } from '../product/helpers.js';

/**
 * The main agent's real tool names: the cli's commands (skills are served by
 * the skill tool, not as commands), the workspace and skill tools Mastra adds,
 * and one `agent-<key>` tool per sub-agent.
 */
async function registeredToolNames(): Promise<string[]> {
  const { cli } = await import('../../src/cli.js');
  const { SUB_AGENT_KEYS } = await import('../../src/agents/agent.js');
  const skillIds = new Set(Object.keys(cli.getMetadata().prompts?.skills ?? {}));
  const commands = cli
    .listCommands()
    .map((c) => c.id)
    .filter((id) => !skillIds.has(id));
  const dir = mkdtempSync(path.join(tmpdir(), 'phase-tools-'));
  try {
    const workspace = new Workspace({
      filesystem: new LocalFilesystem({ basePath: dir }),
      sandbox: new LocalSandbox({ workingDirectory: dir }),
    });
    const workspaceTools = Object.keys(await createWorkspaceTools(workspace));
    const skillTools = Object.keys(createSkillTools(undefined as never));
    // The running project's reactor MCP tools are discovered at runtime as
    // `${service.id}-mcp__<tool>`; one stands in for them here.
    const mcpTools = ['reactor-project-mcp__addActions'];
    return [
      ...commands,
      ...workspaceTools,
      ...skillTools,
      ...SUB_AGENT_KEYS.map((k) => `agent-${k}`),
      ...mcpTools,
    ];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let names: string[] = [];
beforeAll(async () => {
  names = await registeredToolNames();
}, 60_000);

const toolMap = () => Object.fromEntries(names.map((n) => [n, {}]));

function stepArgs(
  state: Record<string, unknown>,
  steps: Array<{ toolCalls: Array<{ payload: { toolName: string } }> }> = [],
): ProcessInputStepArgs {
  return { state, steps, tools: toolMap(), stepNumber: steps.length } as unknown as ProcessInputStepArgs;
}

async function visibleTools(h: ProductHarness): Promise<string[] | undefined> {
  const result = await new PhaseToolsProcessor(h.ctx).processInputStep(stepArgs({}));
  return result?.activeTools;
}

describe('phase tool sets', () => {
  let h: ProductHarness | undefined;
  afterEach(async () => {
    await h?.kill();
    h = undefined;
  });

  it('every registered tool is classified', () => {
    expect(names.length).toBeGreaterThan(40);
    const phases = Object.entries(PHASE_TOOLS).filter(([k]) => k !== 'NONE').flatMap(([, v]) => v);
    const unclassified = names.filter(
      (n) => !matchesAny(n, ALWAYS_ON) && !matchesAny(n, phases) && !matchesAny(n, ADVANCED_ONLY),
    );
    expect(unclassified).toEqual([]);
    // Every pattern names at least one real tool (no stale or misspelt names).
    const dead = [...ALWAYS_ON, ...phases, ...ADVANCED_ONLY].filter((p) => !names.some((n) => matchesAny(n, [p])));
    expect(dead).toEqual([]);
    // Deploy and GitHub tools are in no phase set and not always on (F25).
    const hidden = names.filter((n) => /^(deploy|github)-/.test(n));
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.filter((n) => matchesAny(n, [...ALWAYS_ON, ...phases]))).toEqual([]);
  });

  it('DATA step exposes model tools and hides editor tools', async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: 'plan', steps: [{ kind: 'PLAN' }, { kind: 'DATA' }, { kind: 'EDITORS' }] });
    await runProgress(h.ctx, { action: 'start', step: 'DATA' });
    const tools = await visibleTools(h);
    for (const t of [
      'spec-create',
      'spec-update',
      'spec-schema',
      'spec-generate',
      'mastra_workspace_edit_file',
      'reactor-project-init',
      'reactor-project-check',
      'agent-agentDocumentModel',
      'reactor-project-mcp__addActions',
      'product-progress',
      'skill',
    ]) {
      expect(tools).toContain(t);
    }
    for (const t of ['agent-agentEditor', 'agent-agentApp', 'deploy-environment-create', 'github-push']) {
      expect(tools).not.toContain(t);
    }
    // Nothing advanced-only is visible mid-build.
    expect(tools!.filter((n) => matchesAny(n, ADVANCED_ONLY))).toEqual([]);
    expect(tools!.length).toBeLessThan(names.length);
  });

  it('LIVE step exposes no deploy tools', async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: 'plan', steps: [{ kind: 'LIVE' }] });
    await runProgress(h.ctx, { action: 'start', step: 'LIVE' });
    const tools = await visibleTools(h);
    expect(tools!.filter((n) => /^(deploy|github)-/.test(n))).toEqual([]);
    expect(tools!.every((n) => matchesAny(n, ALWAYS_ON))).toBe(true);
  });

  it('no product document → all tools', async () => {
    h = await productHarness({ product: false });
    expect(await visibleTools(h)).toBeUndefined();
  });

  it('no active change → all tools', async () => {
    const read = (async () => ({
      id: 'p',
      state: { activeChangeId: null, changes: [] },
    })) as unknown as typeof getProductDoc;
    const result = await new PhaseToolsProcessor({}, read).processInputStep(stepArgs({}));
    expect(result).toBeUndefined();
  });

  it('an active change between steps gets its next unfinished step, never deploy (F18)', async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: 'plan', steps: [{ kind: 'PLAN' }, { kind: 'DATA' }, { kind: 'EDITORS' }] });
    // Not started: the plan step's tools.
    const tools = await visibleTools(h);
    expect(tools).toContain('spec-create');
    expect(tools).not.toContain('reactor-project-init');
    expect(tools).not.toContain('deploy-environment-list');
  });

  it('DATA done and EDITORS not started → the EDITORS set, not every tool (F18)', async () => {
    const read = (async () => ({
      id: 'p',
      state: {
        activeChangeId: 'c',
        changes: [
          {
            id: 'c',
            status: 'BUILDING',
            steps: [
              { kind: 'PLAN', status: 'DONE' },
              { kind: 'DATA', status: 'DONE' },
              { kind: 'EDITORS', status: 'NOT_STARTED' },
              { kind: 'TESTS', status: 'NOT_STARTED' },
            ],
          },
        ],
      },
    })) as unknown as typeof getProductDoc;
    const result = await new PhaseToolsProcessor({}, read).processInputStep(stepArgs({}));
    const tools = result?.activeTools;
    expect(tools).toBeDefined();
    expect(tools).toContain('agent-agentEditor');
    expect(tools).toContain('spec-preview-show');
    expect(tools).not.toContain('agent-agentDocumentModel');
    expect(tools).not.toContain('reactor-project-init');
    expect(tools!.filter((n) => /^(deploy|github)-/.test(n))).toEqual([]);
    expect(tools!.length).toBeLessThan(names.length);
  });

  it('an active change with no steps yet gets the plan tools', async () => {
    h = await productHarness();
    const tools = await visibleTools(h);
    expect(tools).toContain('product-progress');
    expect(tools).toContain('spec-create');
    expect(tools).not.toContain('github-push');
  });

  it('a step sent back counts as the active one', async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: 'plan', steps: [{ kind: 'PLAN' }, { kind: 'EDITORS' }] });
    await runProgress(h.ctx, { action: 'start', step: 'PLAN' });
    await runProgress(h.ctx, { action: 'name', text: 'Team Tasks' });
    await runProgress(h.ctx, { action: 'title', text: 'First version' });
    expect(await runProgress(h.ctx, { action: 'done', step: 'PLAN' })).toBe('Plan done.');
    await runProgress(h.ctx, { action: 'start', step: 'EDITORS' });
    expect(await visibleTools(h)).toContain('agent-agentEditor');
    await runProgress(h.ctx, { action: 'back', step: 'PLAN', reason: 'new feature' });
    const tools = await visibleTools(h);
    expect(tools).toContain('spec-extract');
    expect(tools).toContain('agent-agentEditor');
  });

  it('a failed product read falls back to every tool and logs', async () => {
    const warn = jest.fn<(msg: string) => void>();
    const read = (async () => {
      throw new Error('reactor down');
    }) as unknown as typeof getProductDoc;
    const result = await new PhaseToolsProcessor({ log: { warn } }, read).processInputStep(stepArgs({}));
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reactor down'));
  });

  it('reads once per turn and again after a product-progress step', async () => {
    let status = 'WORKING';
    const read = jest.fn(async () => ({
      id: 'p',
      state: {
        activeChangeId: 'c',
        changes: [
          {
            id: 'c',
            status: 'BUILDING',
            steps: [
              { kind: 'DATA', status },
              { kind: 'EDITORS', status: status === 'WORKING' ? 'NOT_STARTED' : 'WORKING' },
            ],
          },
        ],
      },
    })) as unknown as typeof getProductDoc;
    const processor = new PhaseToolsProcessor({}, read);
    const state: Record<string, unknown> = {};
    const call = (toolName: string) => ({ toolCalls: [{ payload: { toolName } }] });

    let r = await processor.processInputStep(stepArgs(state));
    expect(r?.activeTools).toContain('agent-agentDocumentModel');
    r = await processor.processInputStep(stepArgs(state, [call('spec-generate')]));
    expect(read).toHaveBeenCalledTimes(1);

    status = 'DONE';
    r = await processor.processInputStep(stepArgs(state, [call('spec-generate'), call('product-progress')]));
    expect(read).toHaveBeenCalledTimes(2);
    expect(r?.activeTools).toContain('agent-agentEditor');
    expect(r?.activeTools).not.toContain('agent-agentDocumentModel');
  });

  // Real Mastra step records leave `toolCalls`/`content` empty and carry the
  // calls only in `response.messages` (found in the Task 0.6 real-model run:
  // the tool set stayed on PLAN after `start DATA`).
  it('re-reads after product-progress when the call is only in response.messages', async () => {
    let steps = [{ kind: 'PLAN', status: 'WORKING' }];
    const read = jest.fn(async () => ({
      id: 'p',
      state: { activeChangeId: 'c', changes: [{ id: 'c', status: 'BUILDING', steps }] },
    })) as unknown as typeof getProductDoc;
    const processor = new PhaseToolsProcessor({}, read);
    const state: Record<string, unknown> = {};
    const mastraStep = (toolName: string) => ({
      content: [],
      toolCalls: [],
      response: {
        messages: [
          { role: 'assistant', content: [{ type: 'tool-call', toolName: 'spec-create' }] },
          { role: 'tool', content: [] },
          { role: 'assistant', content: [{ type: 'tool-call', toolName }] },
          { role: 'tool', content: [] },
        ],
      },
    });
    const args = (s: unknown[]) => stepArgs(state, s as Parameters<typeof stepArgs>[1]);

    let r = await processor.processInputStep(args([]));
    expect(r?.activeTools).not.toContain('reactor-project-init');
    steps = [
      { kind: 'PLAN', status: 'DONE' },
      { kind: 'DATA', status: 'WORKING' },
    ];
    r = await processor.processInputStep(args([mastraStep('product-progress')]));
    expect(read).toHaveBeenCalledTimes(2);
    expect(r?.activeTools).toContain('reactor-project-init');
    r = await processor.processInputStep(args([mastraStep('product-progress'), mastraStep('spec-generate')]));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('github-push is turned off while a product exists (F25)', async () => {
    h = await productHarness();
    const result = await githubPush.execute({ branch: 'main', message: 'x' }, h.ctx as never);
    expect(result).toEqual({ text: PUSH_OFF_FOR_PRODUCT });
  });
});
