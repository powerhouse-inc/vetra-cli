import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROFILES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts', 'agent-profiles');
const MAX_MAIN_INSTRUCTION_BYTES = 8 * 1024;

/** The main agent's always-loaded instructions: its profile sections, as the build joins them. */
async function mainInstructions(): Promise<string> {
  const { cli } = await import('../../src/cli.js');
  const sections = cli.getMetadata().prompts?.agents['vetra-agent']?.sections ?? [];
  expect(sections.length).toBeGreaterThan(0);
  return sections.map((s) => readFileSync(path.join(PROFILES_DIR, s), 'utf-8')).join('\n');
}

describe('main agent instructions', () => {
  it('always-loaded main instructions are at most 8 KB', async () => {
    const bytes = Buffer.byteLength(await mainInstructions(), 'utf-8');
    expect(bytes).toBeLessThanOrEqual(MAX_MAIN_INSTRUCTION_BYTES);
  }, 60_000);

  it('points each build phase at the skill that carries its detail', async () => {
    const text = await mainInstructions();
    for (const skill of [
      'reactor-project-management',
      'document-modeling',
      'document-editor-creation',
      'drive-app-creation',
      'product-specs',
      'example-data',
    ]) {
      expect(text).toContain(skill);
    }
  }, 60_000);
});
