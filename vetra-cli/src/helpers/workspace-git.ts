import fs from 'node:fs';
import path from 'node:path';

// Secrets never go into a version: env files and npm credentials stay out too.
// The Studio image points pnpm's store into the workspace (`.pnpm-store/`).
const WORKSPACE_GITIGNORE_ENTRIES = ['.ph/', 'node_modules/', '.env*', '.npmrc', '.pnpm-store/'];

/**
 * `git -c` args that let git work in the workspace even when the directory is
 * owned by another user: a Studio's workspace is a volume root owned by root
 * (group `clint`), and git >= 2.35.2 refuses such a repo as "dubious
 * ownership". Command-line config is protected, so git honors it; the
 * exception is scoped to this one workspace.
 */
export function workspaceSafeDirectory(workdir: string): string[] {
  let dir = path.resolve(workdir);
  try {
    dir = fs.realpathSync(dir);
  } catch {
    // not created yet: the resolved path is what git will see
  }
  return ['-c', `safe.directory=${dir}`];
}

/** Ensure the workspace repo's root `.gitignore` excludes the agent runtime
 * directory (`.ph/`, which holds the keypair and Renown credential),
 * `node_modules/`, env files, `.npmrc` and the pnpm store. Idempotent. */
export function ensureWorkspaceGitignore(workdir: string): void {
  const file = path.join(workdir, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const present = new Set(existing.split('\n').map((line) => line.trim()));
  const missing = WORKSPACE_GITIGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing;
  fs.writeFileSync(file, `${prefix}${missing.join('\n')}\n`);
}
