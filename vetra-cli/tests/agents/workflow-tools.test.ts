import { beforeAll, describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StepKind } from 'vetra-app/document-models/studio-product';
import { selectTools } from '../../src/agents/phase-tools.js';
import { registeredToolNames } from './tool-names.js';

/**
 * M0 regression (0.0.8-dev.9 on staging): the workflow said "go straight to
 * `reactor-project-init`" while the PLAN step's tool set had no init tool. The
 * agent concluded the Studio had none and hand-wrote a project. Every tool
 * the workflow, or a skill it loads for a step, tells the agent to use in a
 * step must be visible in that step (and be a real tool, so visible in NONE).
 */
const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts');
const WORKFLOW = readFileSync(path.join(PROMPTS_DIR, 'agent-profiles', 'workflow.md'), 'utf-8');
const STEPS: StepKind[] = ['PLAN', 'DATA', 'EDITORS', 'TESTS', 'LIVE'];

let names: string[] = [];
let skillIds: Set<string>;
beforeAll(async () => {
  names = await registeredToolNames();
  const { cli } = await import('../../src/cli.js');
  skillIds = new Set(Object.keys(cli.getMetadata().prompts?.skills ?? {}));
}, 60_000);

/**
 * Tool names a text tells the agent to call: the leading word of each `code`
 * span, `{{commands.<id>.id}}` template refs and indented code lines, kept
 * when they name a registered tool.
 */
function namedTools(text: string): string[] {
  const words = [
    // Not file names: `config.ts` is no call to the `config` tool.
    ...[...text.matchAll(/`([\w-]+)(?![\w.-])[^`]*`/g)].map((m) => m[1]),
    ...[...text.matchAll(/\{\{commands\.([\w-]+)\.id\}\}/g)].map((m) => m[1]),
    ...[...text.matchAll(/^ {4,}([\w-]+)/gm)].map((m) => m[1]),
  ];
  return [...new Set(words.filter((w) => names.includes(w)))].sort();
}

/** The skills a text names in `code` spans. */
function namedSkills(text: string): string[] {
  return [...new Set([...text.matchAll(/`([\w-]+)`/g)].map((m) => m[1]).filter((w) => skillIds.has(w)))];
}

function skillText(skill: string): string {
  const dir = path.join(PROMPTS_DIR, 'skills-tpl', skill);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => readFileSync(path.join(dir, f), 'utf-8'))
    .join('\n');
}

/** The workflow table: step → its row's text. */
function tableRows(): Map<StepKind, string> {
  const rows = new Map<StepKind, string>();
  for (const line of WORKFLOW.split('\n')) {
    const step = /^\| (\w+) \|/.exec(line)?.[1] as StepKind | undefined;
    if (step && STEPS.includes(step)) rows.set(step, line);
  }
  return rows;
}

function hidden(tools: string[], step: StepKind): string[] {
  const visible = selectTools(tools, [step]);
  return tools.filter((t) => !visible.includes(t));
}

describe('workflow and step tool sets agree (M0)', () => {
  it('the table has a row for every step', () => {
    expect([...tableRows().keys()]).toEqual(STEPS);
  });

  it.each(STEPS)('every tool the %s row and its skills name is visible in that step', (step) => {
    const row = tableRows().get(step)!;
    const skills = namedSkills(row);
    const tools = namedTools([row, ...skills.map(skillText)].join('\n'));
    // LIVE launches by itself and names no tool.
    expect(tools.length > 0).toBe(step !== 'LIVE');
    expect({ step, skills, hidden: hidden(tools, step) }).toEqual({ step, skills, hidden: [] });
    // Real tool names, so the NONE set (every tool) has them too.
    expect(selectTools(tools, null)).toEqual(tools);
  });

  it('bootstrap is reachable in PLAN, the step a build starts in', () => {
    const row = tableRows().get('PLAN')!;
    expect(namedSkills(row)).toEqual(expect.arrayContaining(['reactor-project-management', 'product-specs']));
    const bootstrap = /Empty workspace[^]*?\n\n/.exec(WORKFLOW)?.[0] ?? '';
    const tools = namedTools(bootstrap);
    expect(tools).toEqual(expect.arrayContaining(['reactor-project-init', 'reactor-project-ls', 'reactor-project-start']));
    expect(hidden(tools, 'PLAN')).toEqual([]);
  });

  it('every tool the workflow names anywhere is a real tool in some step', () => {
    const tools = namedTools(WORKFLOW);
    expect(tools.length).toBeGreaterThan(5);
    const inNoStep = tools.filter((t) => STEPS.every((s) => hidden([t], s).length > 0));
    expect(inNoStep).toEqual([]);
  });

  it('tells the agent to re-check its tools after a step change', () => {
    const text = WORKFLOW.replace(/\s+/g, ' ');
    expect(text).toMatch(/Your tools change with the step: after `start` or `done`, re-check the tool list/);
  });
});
