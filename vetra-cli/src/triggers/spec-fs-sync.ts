/**
 * Spec-fs-sync trigger — filesystem → Vetra-drive mirror for EXTERNAL edits.
 *
 * Watches every reactor project's `specs/**\/*.phd` under the workdir and pushes
 * changes into the embedded reactor + `vetra-cli` drive via
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

// Directory names never worth descending into when scanning for specs. Keeping
// these out keeps the recursive workdir watch cheap and avoids watching huge
// trees like node_modules.
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

function isIgnoredPath(p: string): boolean {
  return p.split(path.sep).some((seg) => IGNORED_DIRS.has(seg));
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
    const watcher = chokidar.watch(workdir, {
      ignoreInitial: false,
      ignored: (p: string) => isIgnoredPath(p),
      awaitWriteFinish: { stabilityThreshold: 75, pollInterval: 25 },
    });
    const onFsEvent = (kind: string) => (p: string) => {
      if (!p.endsWith(".phd") || !specForPath(p)) return;
      ctx.state.changed.add(p);
      log?.debug?.(`[spec-fs-sync] fs ${kind}: ${p}`);
    };
    watcher.on("add", onFsEvent("add"));
    watcher.on("change", onFsEvent("change"));
    watcher.on("unlink", (p: string) => {
      if (!p.endsWith(".phd") || !specForPath(p)) return;
      ctx.state.changed.delete(p);
      ctx.state.removed.add(p);
      log?.debug?.(`[spec-fs-sync] fs unlink: ${p}`);
    });
    watcher.on("error", (err) =>
      log?.error?.(
        `[spec-fs-sync] watcher error: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    watcher.on("ready", () =>
      log?.debug?.(`[spec-fs-sync] watching ${workdir} for specs/**/*.phd`),
    );
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
