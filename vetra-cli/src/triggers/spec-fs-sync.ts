/**
 * Spec-fs-sync trigger — filesystem → Vetra-drive mirror for EXTERNAL edits.
 *
 * Watches every reactor project's `specs/**\/*.phd` under the workdir and pushes
 * changes into the embedded reactor + `vetra` drive via
 * `applyFsChangesToReactor` (shared with the `spec-*` write commands, in
 * `helpers/spec-drive-sync.ts`). Command-originated writes already push the
 * drive directly and synchronously, so this watcher's job is the rest:
 * hand-edited `.phd`, `git pull`, reactor-project writes.
 *
 * Layout: the workdir is a workspace parent; each reactor project is an
 * immediate subdir with a `powerhouse.config.json`. Specs live at
 * `<workdir>/<project>/specs/<subdir>/<name>.<ext>.phd`. The single-project
 * case (`<workdir>` is itself a project, specs at `<workdir>/specs/`) is also
 * supported — those docs attach at the drive root.
 *
 * The reactor's load-job executor filters incoming operations by `action.id`,
 * so re-feeding a file the commands already pushed is a convergent no-op — no
 * echo-guard needed.
 */
import chokidar from "chokidar";
import path from "node:path";
import type { ReactorContext } from "@powerhousedao/ph-clint";
import {
  applyFsChangesToReactor,
  removeSpecFromDrive,
  specForPath,
  SPECS_DIRNAME,
} from "../helpers/spec-drive-sync.js";
import { defineTrigger } from "../framework.js";

interface TriggerState {
  changed: Set<string>;
  removed: Set<string>;
  // Path → docId for files synced this session, so an external unlink (file
  // gone, can't reload to recover the id) can resolve the doc to remove.
  docIdByPath: Map<string, string>;
  watcher: ReturnType<typeof chokidar.watch> | undefined;
  driveId: string | undefined;
}

// Directory names never worth descending into when scanning for specs.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".ph",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
]);

// Specs live only under a `specs/` folder: `<workdir>/specs/...` or
// `<workdir>/<project>/specs/...`. A path is in scope if it is the workdir
// root, an immediate child (root `specs/` or a project dir, watched so a
// `specs/` folder created later is seen), or anything under a `specs/` segment.
// Deeper non-specs dirs (project src trees, etc.) are pruned so chokidar never
// descends them. IGNORED_DIRS are always out of scope.
function outOfSpecScope(p: string, workdir: string): boolean {
  const rel = path.relative(workdir, p);
  if (rel === "" || rel.startsWith("..")) return false;
  const segs = rel.split(path.sep);
  if (segs.some((s) => IGNORED_DIRS.has(s))) return true;
  if (segs.includes(SPECS_DIRNAME)) return false;
  return segs.length > 1;
}

// What chokidar currently tracks: .phd files retained in the watch set, and
// the directory count (inotify is per-dir, so dirs are watched for discovery
// regardless of how many specs they hold).
function watchedCounts(watcher: ReturnType<typeof chokidar.watch>): {
  phd: number;
  dirs: number;
} {
  const watched = watcher.getWatched();
  let phd = 0;
  for (const entries of Object.values(watched)) {
    for (const e of entries) if (e.endsWith(".phd")) phd++;
  }
  return { phd, dirs: Object.keys(watched).length };
}

export const specFsSyncTrigger = defineTrigger<TriggerState>({
  id: "spec-fs-sync",
  type: "condition",
  state: () => ({
    changed: new Set<string>(),
    removed: new Set<string>(),
    docIdByPath: new Map<string, string>(),
    watcher: undefined,
    driveId: undefined,
  }),

  async setup(ctx) {
    const workdir = ctx.context.workdir;
    const log = ctx.context.log;
    // Watch the workdir directory itself rather than per-project specs globs.
    // The directory always exists, so chokidar reliably picks up `specs/`
    // subtrees created later (reactor-project-init runs after startup) without
    // a reconcile step or fragile not-yet-existent glob bases. `specForPath`
    // filters events down to `specs/<known-subdir>/*.phd` for both the
    // workdir-as-project and workspace (`<workdir>/<project>/specs/`) layouts.
    // ignoreInitial:false so specs written before this daemon started are
    // synced on boot too (loadBatch + node attach are idempotent).
    // Traversal is scoped to specs/ folders (outOfSpecScope) and only .phd
    // files are retained in the watch set, so chokidar tracks specs — not whole
    // project trees.
    const watcher = chokidar.watch(workdir, {
      ignoreInitial: false,
      ignored: (p: string, stats?: { isFile(): boolean }) =>
        outOfSpecScope(p, workdir) ||
        (stats?.isFile() === true && !p.endsWith(".phd")),
      awaitWriteFinish: { stabilityThreshold: 75, pollInterval: 25 },
    });
    // Throttle the watched-count log so add/unlink storms (e.g. a git pull)
    // emit at most one count line per second.
    let lastCountLog = 0;
    const logWatchedCount = () => {
      const now = Date.now();
      if (now - lastCountLog < 1000) return;
      lastCountLog = now;
      const { phd, dirs } = watchedCounts(watcher);
      log?.debug?.(
        `[spec-fs-sync] watching ${phd} .phd file(s) across ${dirs} dir(s)`,
      );
    };
    const onFsEvent = (kind: string) => (p: string) => {
      if (!p.endsWith(".phd") || !specForPath(p)) return;
      ctx.state.changed.add(p);
      log?.debug?.(`[spec-fs-sync] fs ${kind}: ${p}`);
      logWatchedCount();
    };
    watcher.on("add", onFsEvent("add"));
    watcher.on("change", onFsEvent("change"));
    watcher.on("unlink", (p: string) => {
      if (!p.endsWith(".phd") || !specForPath(p)) return;
      ctx.state.changed.delete(p);
      ctx.state.removed.add(p);
      log?.debug?.(`[spec-fs-sync] fs unlink: ${p}`);
      logWatchedCount();
    });
    watcher.on("error", (err) =>
      log?.error?.(
        `[spec-fs-sync] watcher error: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    watcher.on("ready", () => {
      const { phd, dirs } = watchedCounts(watcher);
      log?.debug?.(
        `[spec-fs-sync] watching ${workdir} for specs/**/*.phd (${phd} .phd file(s) across ${dirs} dir(s))`,
      );
    });
    ctx.state.watcher = watcher;
  },

  async teardown(ctx) {
    await ctx.state.watcher?.close();
  },

  async poll(ctx) {
    // No boot-time orphan reconciliation: the embedded drive is rebuilt from
    // the FS scan on each daemon restart, so offline/one-shot deletes
    // self-heal. This only mirrors deletes observed live this session.
    if (ctx.state.changed.size === 0 && ctx.state.removed.size === 0)
      return null;
    const reactor = await ctx.reactor();
    if (!reactor) return null;
    ctx.state.driveId ??=
      (reactor as { personalDriveId?: string; driveId?: string })
        .personalDriveId ??
      (reactor as { driveId?: string }).driveId;
    const log = ctx.context.log;

    // Changes before removals: a rename/atomic-save emits unlink(old) +
    // add(new) for the same doc id in one cycle. Syncing the new path first
    // registers its docId, so the removal pass can recognize the old path as a
    // move and skip it — re-materializing is a dedup no-op, but removing the
    // doc's node only to re-add it would conflict with its persisted revision.
    if (ctx.state.changed.size > 0) {
      const paths = [...ctx.state.changed];
      ctx.state.changed.clear();
      log?.debug?.(
        `[spec-fs-sync] syncing ${paths.length} changed spec file(s): ${paths
          .map((p) => path.basename(p))
          .join(", ")}`,
      );
      try {
        await applyFsChangesToReactor(
          paths,
          ctx.context.workdir,
          reactor as unknown as Pick<ReactorContext, "client">,
          ctx.state.driveId,
          log,
          (filePath, docId) => ctx.state.docIdByPath.set(filePath, docId),
        );
      } catch {
        // logged in helper
      }
    }

    if (ctx.state.removed.size > 0 && ctx.state.driveId) {
      const removed = [...ctx.state.removed];
      ctx.state.removed.clear();
      for (const p of removed) {
        const docId = ctx.state.docIdByPath.get(p);
        if (!docId) {
          log?.debug?.(
            `[spec-fs-sync] no tracked docId for removed ${path.basename(p)} — skipping`,
          );
          continue;
        }
        ctx.state.docIdByPath.delete(p);
        // Same docId still tracked under another path → this was a move, not a
        // delete. The destination already re-synced above; leave the node.
        const movedTo = [...ctx.state.docIdByPath.values()].includes(docId);
        if (movedTo) {
          log?.debug?.(
            `[spec-fs-sync] ${path.basename(p)} moved (doc ${docId} still on disk) — keeping drive node`,
          );
          continue;
        }
        await removeSpecFromDrive(
          reactor as unknown as Pick<ReactorContext, "client">,
          ctx.state.driveId,
          docId,
          log,
        );
      }
    }
    return null;
  },
});
