/**
 * Spec-fs-sync trigger — filesystem → Vetra-drive mirror.
 *
 * Sibling of `spec-sync` (drive → filesystem). Watches `<workdir>/specs/**\/*.phd`
 * for adds / changes, loads each file's operation history via
 * `baseLoadFromFile`, and replays the operations into the embedded reactor
 * with `client.loadBatch`.
 *
 * The reactor's load-job executor filters incoming operations by
 * `action.id` against what's already in the store, so re-feeding the same
 * file is a successful no-op. That's the property that closes the loop
 * with `spec-sync` without needing an echo-guard: when the drive-side
 * trigger writes a `.phd` after a doc changes, the FS watcher fires, the
 * file's operations are already all in the store, and `loadBatch` skips
 * them.
 *
 * The unit on disk is `<projectDir>/specs/<subdir>/<name>.<ext>.phd`. The
 * subdir → documentType mapping (and the matching reducer) come from
 * `@powerhousedao/vetra/codegen`'s spec registry, so adding a new spec
 * type updates both sides automatically.
 */
import chokidar from "chokidar";
import path from "node:path";
import { baseLoadFromFile } from "document-model/node";
import { getSpecEntry, listSpecDocumentTypes } from "@powerhousedao/vetra/codegen";
import type { ReactorContext } from "@powerhousedao/ph-clint";
import type { LoadJobPlan } from "@powerhousedao/reactor";
import { defineTrigger } from "../framework.js";

interface SpecRegistration {
  documentType: string;
  subdir: string;
  reducer: (state: unknown, action: unknown) => unknown;
}

const SUBDIR_TO_SPEC = new Map<string, SpecRegistration>();
for (const documentType of listSpecDocumentTypes()) {
  const entry = getSpecEntry(documentType);
  SUBDIR_TO_SPEC.set(entry.subdir, {
    documentType,
    subdir: entry.subdir,
    reducer: entry.reducer as never,
  });
}

interface FsSyncLogger {
  debug?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

/**
 * Infer the spec registration for a `.phd` path by looking at the subdir
 * immediately containing the file. Returns undefined when the path is
 * outside the `specs/<subdir>/` layout.
 */
export function specForPath(
  filePath: string,
  workdir: string,
): SpecRegistration | undefined {
  const rel = path.relative(path.join(workdir, "specs"), filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const segments = rel.split(path.sep);
  if (segments.length < 2) return undefined;
  return SUBDIR_TO_SPEC.get(segments[0]);
}

/**
 * Load a `.phd` file and convert its per-scope operation history into a
 * set of `LoadJobPlan`s suitable for `client.loadBatch`. Returns an empty
 * array when the file has no operations to ship.
 *
 * Cross-scope ordering: every non-`document` scope job declares
 * `dependsOn: [document-scope job key]` so the create/upgrade actions
 * apply before any state mutations.
 */
export async function buildLoadJobsForFile(
  filePath: string,
  workdir: string,
  log?: FsSyncLogger,
): Promise<LoadJobPlan[]> {
  const spec = specForPath(filePath, workdir);
  if (!spec) {
    log?.warn?.(
      `[spec-fs-sync] skip ${filePath}: not under a known specs/<subdir>/`,
    );
    return [];
  }

  let doc;
  try {
    doc = await baseLoadFromFile(filePath, spec.reducer as never);
  } catch (err) {
    log?.warn?.(
      `[spec-fs-sync] load failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const branch = doc.header.branch || "main";
  const documentKey = `${doc.header.id}:document`;
  // Emit the `document` scope first so other scopes can declare a
  // dependency on it. Scope iteration order is otherwise unspecified.
  const entries = Object.entries(doc.operations).filter(
    ([, ops]) => Array.isArray(ops) && ops.length > 0,
  );
  const hasDocumentJob = entries.some(([scope]) => scope === "document");
  entries.sort(([a], [b]) => (a === "document" ? -1 : b === "document" ? 1 : 0));
  const jobs: LoadJobPlan[] = [];
  for (const [scope, ops] of entries) {
    jobs.push({
      key: `${doc.header.id}:${scope}`,
      documentId: doc.header.id,
      scope,
      branch,
      operations: ops,
      // Only declare a dependency on the document-scope job when that
      // job is actually part of this batch. Without the guard, loadBatch
      // rejects with "depends on non-existent key" when we're only
      // syncing state-scope mutations to a doc the drive already has.
      dependsOn: scope !== "document" && hasDocumentJob ? [documentKey] : [],
      externalDeps: [],
    });
  }
  return jobs;
}

/**
 * Read each path, build per-scope jobs, and submit them as a single
 * `loadBatch`. Returns the number of jobs submitted. Exported for the
 * trigger's poll and for direct use in integration tests.
 */
export async function applyFsChangesToReactor(
  paths: ReadonlyArray<string>,
  workdir: string,
  reactor: Pick<ReactorContext, "client">,
  log?: FsSyncLogger,
): Promise<number> {
  const allJobs: LoadJobPlan[] = [];
  for (const p of paths) {
    const jobs = await buildLoadJobsForFile(p, workdir, log);
    allJobs.push(...jobs);
  }
  if (allJobs.length === 0) return 0;
  try {
    await reactor.client.loadBatch({ jobs: allJobs });
    log?.debug?.(
      `[spec-fs-sync] loadBatch submitted ${allJobs.length} job(s)`,
    );
  } catch (err) {
    log?.error?.(
      `[spec-fs-sync] loadBatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
  return allJobs.length;
}

interface TriggerState {
  changed: Set<string>;
  watcher: ReturnType<typeof chokidar.watch> | undefined;
}

export const specFsSyncTrigger = defineTrigger<TriggerState>({
  id: "spec-fs-sync",
  type: "condition",
  state: () => ({ changed: new Set<string>(), watcher: undefined }),

  async setup(ctx) {
    const root = path.join(ctx.context.workdir, "specs");
    // awaitWriteFinish guards against firing while an editor is mid-save.
    const watcher = chokidar.watch(`${root}/**/*.phd`, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 75, pollInterval: 25 },
    });
    watcher.on("add", (p) => ctx.state.changed.add(p));
    watcher.on("change", (p) => ctx.state.changed.add(p));
    ctx.state.watcher = watcher;
    ctx.context.log?.debug?.(`[spec-fs-sync] watching ${root}`);
  },

  async teardown(ctx) {
    await ctx.state.watcher?.close();
  },

  async poll(ctx) {
    if (ctx.state.changed.size === 0) return null;
    const reactor = await ctx.reactor();
    if (!reactor) return null;
    const paths = [...ctx.state.changed];
    ctx.state.changed.clear();
    try {
      await applyFsChangesToReactor(
        paths,
        ctx.context.workdir,
        reactor as unknown as Pick<ReactorContext, "client">,
        ctx.context.log,
      );
    } catch {
      // logged in helper
    }
    return null;
  },
});
