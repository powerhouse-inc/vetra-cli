import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Task 0.6: the always-loaded workflow drives the Studio's step strip through
 * `product-progress`, and the deploy skill only serves explicit requests.
 */
const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts');
const PROFILES_DIR = path.join(PROMPTS_DIR, 'agent-profiles');
const STEPS = ['PLAN', 'DATA', 'EDITORS', 'TESTS', 'LIVE'];

async function mainInstructions(): Promise<string> {
  const { cli } = await import('../../src/cli.js');
  const sections = cli.getMetadata().prompts?.agents['vetra-agent']?.sections ?? [];
  expect(sections.length).toBeGreaterThan(0);
  return sections.map((s) => readFileSync(path.join(PROFILES_DIR, s), 'utf-8')).join('\n');
}

function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('workflow drives the step strip (Task 0.6)', () => {
  it('workflow tells the agent to plan steps with product-progress', async () => {
    const text = flat(await mainInstructions());
    expect(text).toContain('product-progress');
    for (const step of STEPS) expect(text).toContain(step);
    // The plan call lists all five steps once the brief exists.
    expect(text).toMatch(/Once the brief exists: `plan` PLAN, DATA, EDITORS, TESTS, LIVE/);
  }, 60_000);

  it('names every progress action the build uses', async () => {
    const text = flat(await mainInstructions());
    for (const action of ['plan', 'start', 'count', 'done', 'back', 'milestone', 'stuck', 'name', 'title']) {
      expect(text).toContain(`\`${action}`);
    }
    expect(text).toMatch(/`name` the product and `title` the change before `done PLAN`/);
    expect(text).toMatch(/`back` with a reason/);
    expect(text).toMatch(/milestone` for each finished thing, in the customer's words/);
    expect(text).toMatch(/`stuck` with what you tried after 3 failed attempts/);
    expect(text).toMatch(/Never claim Tests passed: call `done TESTS` and the tool checks/);
  }, 60_000);

  it('lists the words the customer-facing progress text must not contain', async () => {
    const text = flat(await mainInstructions());
    const clause = /Names, titles, milestones, `start` labels and `back`\/`stuck` reasons never contain: ([^.]*)\./.exec(text)?.[1];
    expect(clause).toBeDefined();
    for (const word of ['environment', 'package', 'registry', 'Harbor', 'image', 'workflow', 'device code', 'approve changes', 'switchboard']) {
      expect(clause).toContain(word);
    }
  }, 60_000);

  it('keeps checks in the recorded tools and the shell for installs only', async () => {
    const text = flat(await mainInstructions());
    expect(text).toMatch(/run only through `reactor-project-check` \(`tests: true`\) or `reactor-project-build`/);
    expect(text).toMatch(/the shell is for installs only — never git commit\/push, deploy or publish through it/);
  }, 60_000);

  it('the deploy skill serves only explicit environment requests', async () => {
    const text = flat(await mainInstructions());
    expect(text).toMatch(/Studio products go live by themselves: load the `deploy` skill only for an explicit "deploy to my environment X" request/);
    const preamble = flat(readFileSync(path.join(PROMPTS_DIR, 'skills-tpl', 'deploy', '.preamble.md'), 'utf-8'));
    expect(preamble.slice(0, 400)).toMatch(/Studio products go live by themselves/);
    const { cli } = await import('../../src/cli.js');
    const description = cli.getMetadata().prompts?.skills?.['deploy']?.description ?? '';
    expect(description).toMatch(/only for an explicit request/i);
  }, 60_000);
});
