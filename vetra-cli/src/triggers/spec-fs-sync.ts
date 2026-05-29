/**
 * Spec-fs-sync trigger — filesystem → Vetra-drive mirror.
 *
 * Sibling of `spec-sync` (drive → filesystem). Watches every reactor project's
 * `specs/**\/*.phd` under the workdir, loads each file's operation history via
 * `baseLoadFromFile`, replays the operations into the embedded reactor with
 * `client.loadBatch`, and attaches the document to the embedded `vetra-cli`
 * drive under a folder named after its project.
 *
 * Layout: the workdir is a workspace parent; each reactor project is an
 * immediate subdir with a `powerhouse.config.json`. Specs live at
 * `<workdir>/<project>/specs/<subdir>/<name>.<ext>.phd`. The single-project
 * case (`<workdir>` is itself a project, specs at `<workdir>/specs/`) is also
 * supported — those docs attach at the drive root.
 *
 * Drive attachment mirrors the per-project folder structure Vetra Studio reads
 * (`drive.state.global.nodes`): an ADD_FOLDER node per project, an ADD_FILE
 * node per spec doc. Both steps are idempotent — they check the existing nodes
 * and skip when present, so re-syncing a file is a no-op.
 *
 * The reactor's load-job executor filters incoming operations by `action.id`
 * against what's already in the store, so re-feeding the same file is a
 * successful no-op. That closes the loop with `spec-sync` without an
 * echo-guard: when the drive-side trigger writes a `.phd` after a doc changes,
 * the FS watcher fires, the file's operations are already in the store, and
 * `loadBatch` skips them. ADD_FILE/ADD_FOLDER mutate the drive document
 * (`powerhouse/document-drive`), which is not a spec type, so they never
 * feed back into `spec-sync`.
 *
 * The subdir → documentType mapping (and the matching reducer) come from
 * `@powerhousedao/vetra/codegen`'s spec registry, so adding a new spec type
 * updates both sides automatically.
 */
import chokidar from "chokidar";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { baseLoadFromFile } from "document-model/node";
import type { ReactorContext } from "@powerhousedao/ph-clint";
import type { LoadJobPlan } from "@powerhousedao/reactor";
import { listReactorProjects, pathExists } from "../helpers/project.js";
import { listSpecTypes, resolveSpecEntry } from "../commands/spec/registry.js";
import { defineTrigger } from "../framework.js";

const SPECS_DIRNAME = "specs";

interface SpecRegistration {
  documentType: string;
  subdir: string;
  reducer: (state: unknown, action: unknown) => unknown;
}

// Built from the merged registry (codegen builder specs + vetra-app domain
// models like brand-sheet), so the watcher recognizes every spec type the
// `spec-*` tools can write — not just the five builder types.
const SUBDIR_TO_SPEC = new Map<string, SpecRegistration>();
for (const documentType of listSpecTypes()) {
  const entry = resolveSpecEntry(documentType);
  SUBDIR_TO_SPEC.set(entry.subdir, {
    documentType,
    subdir: entry.subdir,
    reducer: entry.reducer as never,
  });
}

interface FsSyncLogger {
  debug?: (msg: string) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

/** Minimal node shape from the drive document's `state.global.nodes`. */
interface DriveNode {
  id: string;
  name: string;
  kind: string;
  parentFolder?: string | null;
  documentType?: string;
}

type DriveClient = Pick<ReactorContext, "client">["client"];

/**
 * Infer the spec registration for a `.phd` path from the `specs/<subdir>/`
 * tail. Layout-agnostic: works for both `<workdir>/specs/<subdir>/` and
 * `<workdir>/<project>/specs/<subdir>/`. Returns undefined when the path
 * doesn't sit directly under a `specs/<known-subdir>/` directory.
 */
export function specForPath(filePath: string): SpecRegistration | undefined {
  const segments = filePath.split(path.sep);
  const specsIdx = segments.lastIndexOf(SPECS_DIRNAME);
  // Need `specs/<subdir>/<file>`: a subdir segment and a file after it.
  if (specsIdx === -1 || specsIdx + 2 > segments.length - 1) return undefined;
  return SUBDIR_TO_SPEC.get(segments[specsIdx + 1]);
}

/**
 * Derive the reactor-project name owning a spec file, relative to workdir.
 * Returns the segment(s) before `specs/` (e.g. `workout-tracker`), or
 * undefined when the file is outside workdir or `specs/` is the first segment
 * (the single-project case, where the doc attaches at the drive root).
 */
export function projectForPath(
  filePath: string,
  workdir: string,
): string | undefined {
  const rel = path.relative(workdir, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const segments = rel.split(path.sep);
  const specsIdx = segments.indexOf(SPECS_DIRNAME);
  if (specsIdx <= 0) return undefined;
  return segments.slice(0, specsIdx).join(path.sep);
}

interface LoadedSpec {
  jobs: LoadJobPlan[];
  id: string;
  name: string;
  documentType: string;
}

/**
 * Load a `.phd`, build its per-scope `LoadJobPlan`s, and capture the document
 * identity for drive attachment. Returns undefined when the path isn't a known
 * spec or the file fails to load.
 *
 * Cross-scope ordering: every non-`document` scope job declares
 * `dependsOn: [document-scope job key]` so create/upgrade actions apply before
 * any state mutations.
 */
async function loadSpecForFile(
  filePath: string,
  workdir: string,
  log?: FsSyncLogger,
): Promise<LoadedSpec | undefined> {
  const spec = specForPath(filePath);
  if (!spec) {
    log?.warn?.(
      `[spec-fs-sync] skip ${filePath}: not under a known specs/<subdir>/`,
    );
    return undefined;
  }

  let doc;
  try {
    doc = await baseLoadFromFile(filePath, spec.reducer as never);
  } catch (err) {
    log?.warn?.(
      `[spec-fs-sync] load failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  const branch = doc.header.branch || "main";
  const documentKey = `${doc.header.id}:document`;
  // Emit the `document` scope first so other scopes can declare a dependency
  // on it. Scope iteration order is otherwise unspecified.
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
      // Only declare a dependency on the document-scope job when that job is
      // actually part of this batch. Without the guard, loadBatch rejects with
      // "depends on non-existent key" when we're only syncing state-scope
      // mutations to a doc the drive already has.
      dependsOn: scope !== "document" && hasDocumentJob ? [documentKey] : [],
      externalDeps: [],
    });
  }
  return {
    jobs,
    id: doc.header.id,
    name: doc.header.name,
    documentType: doc.header.documentType,
  };
}

/**
 * Build the `LoadJobPlan`s for a `.phd` file. Returns an empty array when the
 * file has no operations to ship or isn't a known spec. Exported for tests.
 */
export async function buildLoadJobsForFile(
  filePath: string,
  workdir: string,
  log?: FsSyncLogger,
): Promise<LoadJobPlan[]> {
  const loaded = await loadSpecForFile(filePath, workdir, log);
  return loaded?.jobs ?? [];
}

interface DriveActions {
  addFolder: (input: {
    id: string;
    name: string;
    parentFolder: string | null;
  }) => unknown;
  addFile: (input: {
    id: string;
    name: string;
    documentType: string;
    parentFolder: string | null;
  }) => unknown;
}

let _driveActions: DriveActions | null = null;

/**
 * Lazy-load drive action creators from `@powerhousedao/shared`. Kept lazy so
 * importing this module doesn't pull in the full `@powerhousedao/shared` tree.
 */
async function getDriveActions(): Promise<DriveActions> {
  if (!_driveActions) {
    const mod = (await import(
      "@powerhousedao/shared/document-drive"
    )) as unknown as DriveActions;
    _driveActions = { addFolder: mod.addFolder, addFile: mod.addFile };
  }
  return _driveActions;
}

async function getDriveNodes(
  client: DriveClient,
  driveId: string,
): Promise<DriveNode[]> {
  const drive = (await client.get(driveId)) as {
    state?: { global?: { nodes?: DriveNode[] } };
  };
  return drive?.state?.global?.nodes ?? [];
}

/**
 * Ensure a root-level folder named after the project exists in the drive,
 * returning its node id. Returns null for the single-project case (no project
 * segment) so the doc attaches at the drive root. Idempotent: an existing
 * folder of the same name is reused.
 */
async function ensureProjectFolder(
  client: DriveClient,
  driveId: string,
  project: string | undefined,
  log?: FsSyncLogger,
): Promise<string | null> {
  if (!project) return null;
  const nodes = await getDriveNodes(client, driveId);
  const existing = nodes.find(
    (n) =>
      n.kind === "folder" &&
      n.name === project &&
      (n.parentFolder ?? null) === null,
  );
  if (existing) return existing.id;
  const id = randomUUID();
  const { addFolder } = await getDriveActions();
  await client.execute(driveId, "main", [
    addFolder({ id, name: project, parentFolder: null }) as never,
  ]);
  log?.info?.(
    `[spec-fs-sync] created project folder "${project}" folderId=${id} driveId=${driveId}`,
  );
  return id;
}

/**
 * Ensure a file node for `docId` exists under `parentFolder`. Idempotent:
 * skips when a file node with the same id is already present. On create, also
 * links the doc into the drive's document graph (parity with how other drive
 * documents become discoverable).
 */
async function ensureFileNode(
  client: DriveClient,
  driveId: string,
  docId: string,
  name: string,
  documentType: string,
  parentFolder: string | null,
  log?: FsSyncLogger,
): Promise<void> {
  const nodes = await getDriveNodes(client, driveId);
  if (nodes.some((n) => n.kind === "file" && n.id === docId)) return;
  const { addFile } = await getDriveActions();
  await client.execute(driveId, "main", [
    addFile({ id: docId, name, documentType, parentFolder }) as never,
  ]);
  log?.info?.(
    `[spec-fs-sync] created spec in embedded reactor: ${documentType} "${name}" ` +
      `documentId=${docId} driveId=${driveId} folder=${parentFolder ?? "<root>"}`,
  );
  // The file node is what Vetra Studio reads; the graph relationship is parity
  // with other drive docs. Don't let a relationship failure abort the attach.
  try {
    await client.addRelationship(driveId, docId, "child");
  } catch (err) {
    log?.debug?.(
      `[spec-fs-sync] addRelationship skipped for ${docId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Read each path, replay its operations into the reactor as a single
 * `loadBatch`, then attach each loaded doc to the `vetra-cli` drive under its
 * project folder. Returns the number of load jobs submitted. Exported for the
 * trigger's poll and for direct use in integration tests.
 */
export async function applyFsChangesToReactor(
  paths: ReadonlyArray<string>,
  workdir: string,
  reactor: Pick<ReactorContext, "client">,
  driveId: string | undefined,
  log?: FsSyncLogger,
): Promise<number> {
  const loaded: Array<{ project: string | undefined; spec: LoadedSpec }> = [];
  const allJobs: LoadJobPlan[] = [];
  for (const p of paths) {
    const spec = await loadSpecForFile(p, workdir, log);
    if (!spec) continue;
    loaded.push({ project: projectForPath(p, workdir), spec });
    allJobs.push(...spec.jobs);
  }
  if (allJobs.length > 0) {
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
  }

  if (loaded.length === 0) return allJobs.length;
  if (!driveId) {
    log?.warn?.(
      `[spec-fs-sync] no drive id — loaded ${loaded.length} doc(s) but skipped drive attachment`,
    );
    return allJobs.length;
  }

  // Sequential: ensureProjectFolder re-reads nodes, so concurrent attaches to
  // the same new project folder would each miss it and create duplicates.
  for (const { project, spec } of loaded) {
    try {
      const folderId = await ensureProjectFolder(
        reactor.client,
        driveId,
        project,
        log,
      );
      await ensureFileNode(
        reactor.client,
        driveId,
        spec.id,
        spec.name,
        spec.documentType,
        folderId,
        log,
      );
    } catch (err) {
      log?.error?.(
        `[spec-fs-sync] drive attach failed for ${spec.documentType} "${spec.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return allJobs.length;
}

interface TriggerState {
  changed: Set<string>;
  watcher: ReturnType<typeof chokidar.watch> | undefined;
  watched: Set<string>;
  driveId: string | undefined;
}

function projectSpecGlob(workdir: string, project: string): string {
  return path.join(workdir, project, SPECS_DIRNAME, "**", "*.phd");
}

export const specFsSyncTrigger = defineTrigger<TriggerState>({
  id: "spec-fs-sync",
  type: "condition",
  state: () => ({
    changed: new Set<string>(),
    watcher: undefined,
    watched: new Set<string>(),
    driveId: undefined,
  }),

  async setup(ctx) {
    const workdir = ctx.context.workdir;
    const globs: string[] = [];
    // Single-project case: workdir is itself a reactor package.
    if (await pathExists(path.join(workdir, "powerhouse.config.json"))) {
      globs.push(path.join(workdir, SPECS_DIRNAME, "**", "*.phd"));
    }
    const projects = await listReactorProjects(workdir);
    for (const project of projects) {
      globs.push(projectSpecGlob(workdir, project));
      ctx.state.watched.add(project);
    }
    // awaitWriteFinish guards against firing while an editor is mid-save.
    const watcher = chokidar.watch(globs, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 75, pollInterval: 25 },
    });
    watcher.on("add", (p) => ctx.state.changed.add(p));
    watcher.on("change", (p) => ctx.state.changed.add(p));
    ctx.state.watcher = watcher;
    ctx.context.log?.debug?.(
      `[spec-fs-sync] watching ${globs.length} spec root(s) under ${workdir}`,
    );
  },

  async teardown(ctx) {
    await ctx.state.watcher?.close();
  },

  async poll(ctx) {
    // Reconcile newly-created projects (e.g. via reactor-project-init after
    // startup). chokidar's add() scans the glob and emits `add` for files
    // already on disk, so specs written before the project was watched get
    // picked up on the next drain.
    const projects = await listReactorProjects(ctx.context.workdir);
    for (const project of projects) {
      if (!ctx.state.watched.has(project)) {
        ctx.state.watched.add(project);
        ctx.state.watcher?.add(projectSpecGlob(ctx.context.workdir, project));
      }
    }

    if (ctx.state.changed.size === 0) return null;
    const reactor = await ctx.reactor();
    if (!reactor) return null;
    ctx.state.driveId ??=
      (reactor as { personalDriveId?: string; driveId?: string })
        .personalDriveId ??
      (reactor as { driveId?: string }).driveId;
    const paths = [...ctx.state.changed];
    ctx.state.changed.clear();
    try {
      await applyFsChangesToReactor(
        paths,
        ctx.context.workdir,
        reactor as unknown as Pick<ReactorContext, "client">,
        ctx.state.driveId,
        ctx.context.log,
      );
    } catch {
      // logged in helper
    }
    return null;
  },
});
