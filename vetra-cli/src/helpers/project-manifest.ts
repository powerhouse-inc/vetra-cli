import fs from 'node:fs';
import path from 'node:path';

/** A reactor project's package manifest, as `ph build` and Connect read it. */
export const MANIFEST_FILENAME = 'powerhouse.manifest.json';

export function manifestPath(projectDir: string): string {
  return path.join(projectDir, MANIFEST_FILENAME);
}

type Manifest = Record<string, unknown>;

function readManifest(projectDir: string): Manifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(projectDir), 'utf-8')) as Manifest;
  } catch {
    return null;
  }
}

function writeManifest(projectDir: string, manifest: Manifest): void {
  fs.writeFileSync(manifestPath(projectDir), JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Set the manifest's `name` to `name`, the value `ph build` requires to equal
 * package.json's (it fails the build otherwise). Used when publishing under a
 * name other than the project's own (a Studio launch names the package after
 * its address). Returns false when there is no readable manifest.
 */
export function setManifestName(projectDir: string, name: string): boolean {
  const manifest = readManifest(projectDir);
  if (!manifest) return false;
  if (manifest.name === name) return true;
  manifest.name = name;
  writeManifest(projectDir, manifest);
  return true;
}

/** A manifest module entry that names no model: codegen wrote a placeholder. */
function isEmptyDocumentModel(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return true;
  const { id, name } = entry as { id?: unknown; name?: unknown };
  return !(typeof id === 'string' && id.trim() && typeof name === 'string' && name.trim());
}

/**
 * Remove document-model entries that name no model. Codegen derives an entry's
 * `id`/`name` from the spec's `state.global.id`/`.name`; a spec generated
 * before either was set leaves `{ "id": "", "name": "" }` in the manifest,
 * which no consumer can resolve. `spec-generate` refuses such a spec and calls
 * this afterwards to drop a placeholder an earlier run already wrote.
 * Returns the number of entries removed; leaves the file untouched otherwise.
 */
export function pruneEmptyDocumentModels(projectDir: string): number {
  const manifest = readManifest(projectDir);
  if (!manifest) return 0;
  const models = manifest.documentModels;
  if (!Array.isArray(models)) return 0;
  const kept = models.filter((entry) => !isEmptyDocumentModel(entry));
  if (kept.length === models.length) return 0;
  manifest.documentModels = kept;
  writeManifest(projectDir, manifest);
  return models.length - kept.length;
}
