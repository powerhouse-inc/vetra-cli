import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MANIFEST_FILENAME,
  pruneEmptyDocumentModels,
  setManifestName,
} from '../../src/helpers/project-manifest.js';

let dir: string;

function writeManifest(manifest: unknown): void {
  fs.writeFileSync(path.join(dir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2) + '\n');
}

function readManifest(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILENAME), 'utf-8'));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetra-manifest-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('setManifestName', () => {
  it('renames the manifest, keeping every other field', () => {
    writeManifest({ name: 'todo', documentModels: [{ id: 'todo/task', name: 'Task' }] });
    expect(setManifestName(dir, '@vetra-apps/team-todo')).toBe(true);
    expect(readManifest()).toEqual({
      name: '@vetra-apps/team-todo',
      documentModels: [{ id: 'todo/task', name: 'Task' }],
    });
  });

  it('does nothing without a readable manifest', () => {
    expect(setManifestName(dir, 'x')).toBe(false);
    fs.writeFileSync(path.join(dir, MANIFEST_FILENAME), 'not json');
    expect(setManifestName(dir, 'x')).toBe(false);
  });
});

describe('pruneEmptyDocumentModels', () => {
  it('removes entries that name no model and keeps the real ones', () => {
    writeManifest({
      name: 'maengel-baustelle',
      documentModels: [{ id: '', name: '' }, { id: 'baustelle', name: 'Baustelle' }, { id: 'x' }],
    });
    expect(pruneEmptyDocumentModels(dir)).toBe(2);
    expect(readManifest().documentModels).toEqual([{ id: 'baustelle', name: 'Baustelle' }]);
  });

  it('leaves a clean manifest byte-for-byte alone', () => {
    writeManifest({
      name: 'todo',
      documentModels: [{ id: 'todo/task', name: 'Task' }],
    });
    const before = fs.readFileSync(path.join(dir, MANIFEST_FILENAME), 'utf-8');
    expect(pruneEmptyDocumentModels(dir)).toBe(0);
    expect(fs.readFileSync(path.join(dir, MANIFEST_FILENAME), 'utf-8')).toBe(before);
  });

  it('is a no-op without a manifest or documentModels list', () => {
    expect(pruneEmptyDocumentModels(dir)).toBe(0);
    writeManifest({ name: 'todo' });
    expect(pruneEmptyDocumentModels(dir)).toBe(0);
  });
});
