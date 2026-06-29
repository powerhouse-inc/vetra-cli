import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_GITIGNORE_ENTRIES = ['.ph/', 'node_modules/'];

/** Ensure the workspace repo's root `.gitignore` excludes the agent runtime
 * directory (`.ph/`, which holds the keypair and Renown credential) and
 * `node_modules/`. Idempotent. */
export function ensureWorkspaceGitignore(workdir: string): void {
  const file = path.join(workdir, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const present = new Set(existing.split('\n').map((line) => line.trim()));
  const missing = WORKSPACE_GITIGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing;
  fs.writeFileSync(file, `${prefix}${missing.join('\n')}\n`);
}
