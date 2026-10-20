import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression for the "create todo app product" turn on staging (0.0.8-dev.4):
 * in an empty workspace the agent asked "(a) product specs only, or (b) a
 * working package?" instead of building. Ruling R18: a product/app request
 * BUILDS the working package immediately and writes the product specs
 * alongside, without asking; a question is only for genuine ambiguity about
 * WHAT to build. These assertions pin that rule into the always-loaded text.
 */
const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts');
const PROFILES_DIR = path.join(PROMPTS_DIR, 'agent-profiles');

/** The customer prompt that regressed. */
const REGRESSED_PROMPT = 'create todo app product';

async function mainInstructions(): Promise<string> {
  const { cli } = await import('../../src/cli.js');
  const sections = cli.getMetadata().prompts?.agents['vetra-agent']?.sections ?? [];
  expect(sections.length).toBeGreaterThan(0);
  return sections.map((s) => readFileSync(path.join(PROFILES_DIR, s), 'utf-8')).join('\n');
}

/** Collapse hard-wrapped markdown so phrases can be matched across lines. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('main agent builds by default (R18)', () => {
  it('routes a product/app request straight to the build flow, specs alongside, without asking', async () => {
    const text = flat(await mainInstructions());
    // The rule exists and keys on the words the regressed prompt used.
    const rule = /A request to create a product, app or tool[^]*?Ask only when[^.]*\./i.exec(text)?.[0];
    expect(rule).toBeDefined();
    for (const word of ['product', 'app']) {
      expect(REGRESSED_PROMPT).toContain(word);
      expect(rule).toMatch(new RegExp(`\\b${word}\\b`, 'i'));
    }
    expect(rule).toMatch(/build the working package now/i);
    expect(rule).toMatch(/product specs alongside/i);
    expect(rule).toMatch(/don't ask whether to build/i);
    expect(rule).toMatch(/genuinely unclear \*what\* to build/i);
  }, 60_000);

  it('does not present "specs only" as an equal alternative to building', async () => {
    const text = flat(await mainInstructions());
    // The 78f0fe0 wording that framed specs as a parallel track.
    expect(text).not.toMatch(/Product specs \([^)]*\) skip this spine/i);
    // Any mention of a specs-only path is gated on an explicit request.
    for (const m of text.matchAll(/[^.]*specs[- ]only[^.]*\./gi)) {
      expect(m[0]).toMatch(/explicit|don't offer/i);
    }
    // The build rule comes before any product-spec routing.
    const buildAt = text.search(/build the working package now/i);
    const specsAt = text.search(/`spec-create \{ type, name \}`/);
    expect(buildAt).toBeGreaterThan(-1);
    expect(buildAt).toBeLessThan(specsAt);
  }, 60_000);

  it('the product-specs skill frames itself as part of the build, not a stage before it', () => {
    const preamble = flat(readFileSync(path.join(PROMPTS_DIR, 'skills-tpl', 'product-specs', '.preamble.md'), 'utf-8'));
    expect(preamble).not.toMatch(/before any code/i);
    expect(preamble).not.toMatch(/exist before any project does/i);
    expect(preamble).toMatch(/alongside the build/i);
  });

  it('the product-specs skill description does not read as an alternative to building', async () => {
    const { cli } = await import('../../src/cli.js');
    const description = cli.getMetadata().prompts?.skills?.['product-specs']?.description ?? '';
    expect(description).toMatch(/alongside the build/i);
  }, 60_000);

  // R19: build requests run without check-in questions. The agent loads phase
  // skills itself (no `mode` input reaches it — that only exists on the
  // user-typed skill commands), so the mode is fixed in the text it reads.
  it('runs the build-flow skills in one-shot mode, not confirm-first expert mode', async () => {
    const text = flat(await mainInstructions());
    expect(text).toMatch(/Run every phase skill in `one-shot` mode/);
    expect(text).toMatch(/never the expert\/discovery "confirm with the user" step/);
    for (const skill of BUILD_FLOW_SKILLS) {
      const preamble = flat(readFileSync(path.join(PROMPTS_DIR, 'skills-tpl', skill, '.preamble.md'), 'utf-8'));
      expect(preamble.slice(0, 400)).toMatch(/\*\*Mode:\*\* in the build flow, follow the `one-shot` steps/);
    }
  });
});

const BUILD_FLOW_SKILLS = [
  'reactor-project-management',
  'document-modeling',
  'document-editor-creation',
  'drive-app-creation',
];
