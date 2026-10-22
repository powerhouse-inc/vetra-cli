/**
 * Spec ↔ embedded-drive sync primitives.
 *
 * Shared between the `spec-fs-sync` chokidar trigger (filesystem → drive mirror
 * for external edits) and the `spec-*` write commands (which push their FS
 * writes straight into the running reactor). Both call `applyFsChangesToReactor`
 * to materialize-if-absent → replay content ops → attach the doc to the drive.
 * `spec-delete` calls `removeSpecFromDrive` to tear a doc back out.
 *
 * A spec `.phd` carries content-scope (`global` / `local`) ops plus the
 * `document`-scope create ops `createDocument()` records. The reactor can't
 * replay a create for a document it materializes itself, so the document is
 * materialized separately (`materializeIfAbsent`) and only content scopes are
 * replayed. Those ops keep their file `action.id`s, so `loadBatch` dedups:
 * re-feeding the same file is a no-op and later edits ship as deltas.
 *
 * Drive attachment mirrors the per-project folder structure Vetra Studio reads
 * (`drive.state.global.nodes`): an ADD_FOLDER node per project, an ADD_FILE node
 * per spec doc. Both steps check existing nodes and skip when present, so
 * re-attaching is a no-op. ADD_FILE/ADD_FOLDER mutate the drive document
 * (`powerhouse/document-drive`), not a spec type, so they never feed back into
 * `spec-sync` (drive → FS).
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { baseLoadFromFile } from "document-model/node";
import { signaturePolicyOf } from "document-model";
import type { ReactorContext } from "@powerhousedao/ph-clint";
import type { LoadJobPlan } from "@powerhousedao/reactor";
import {
  createSpecDocument,
  listSpecTypes,
  resolveSpecEntry,
  saveSpec,
} from "../commands/spec/registry.js";
import type { StudioSignatureMode } from "../auth/studio-mode.js";

export const SPECS_DIRNAME = "specs";

export interface SpecRegistration {
  documentType: string;
  subdir: string;
  reducer: (state: unknown, action: unknown) => unknown;
}

export interface FsSyncLogger {
  debug?: (msg: string) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

/** Minimal node shape from the drive document's `state.global.nodes`. */
export interface DriveNode {
  id: string;
  name: string;
  kind: string;
  parentFolder?: string | null;
  documentType?: string;
}

type DriveClient = Pick<ReactorContext, "client">["client"];

// Built from the merged registry (codegen builder specs + vetra-app domain
// models like brand-sheet), so every spec type the `spec-*` tools can write is
// recognized — not just the five builder types.
const SUBDIR_TO_SPEC = new Map<string, SpecRegistration>();
for (const documentType of listSpecTypes()) {
  const entry = resolveSpecEntry(documentType);
  SUBDIR_TO_SPEC.set(entry.subdir, {
    documentType,
    subdir: entry.subdir,
    reducer: entry.reducer as never,
  });
}

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

interface LoadedDoc {
  header: {
    id: string;
    name: string;
    documentType: string;
    branch?: string;
    protocolVersions?: Record<string, number> | null;
  };
  state?: unknown;
  operations: Record<string, unknown[]>;
}

interface LoadedSpec {
  doc: LoadedDoc;
  jobs: LoadJobPlan[];
}

/**
 * Load a `.phd` and build content-scope `LoadJobPlan`s. Returns undefined when
 * the path isn't a known spec or the file fails to load. The `document` scope
 * is left to `materializeIfAbsent`; only content scopes are replayed.
 */
async function loadSpecForFile(
  filePath: string,
  log?: FsSyncLogger,
): Promise<LoadedSpec | undefined> {
  const spec = specForPath(filePath);
  if (!spec) {
    log?.warn?.(
      `[spec-fs-sync] skip ${filePath}: not under a known specs/<subdir>/`,
    );
    return undefined;
  }

  let doc: LoadedDoc;
  try {
    doc = (await baseLoadFromFile(filePath, spec.reducer as never));
  } catch (err) {
    log?.warn?.(
      `[spec-fs-sync] load failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  const branch = doc.header.branch || "main";
  const jobs: LoadJobPlan[] = [];
  for (const [scope, ops] of Object.entries(doc.operations)) {
    // `document` scope is handled by materialization, not replay.
    if (scope === "document" || !Array.isArray(ops) || ops.length === 0) continue;
    jobs.push({
      key: `${doc.header.id}:${scope}`,
      documentId: doc.header.id,
      scope,
      branch,
      operations: ops as LoadJobPlan["operations"],
      dependsOn: [],
      externalDeps: [],
    });
  }
  return { doc, jobs };
}

/**
 * Build the content-scope `LoadJobPlan`s for a `.phd` file. Empty when the file
 * has no content operations or isn't a known spec. Exported for tests.
 */
export async function buildLoadJobsForFile(
  filePath: string,
  workdir: string,
  log?: FsSyncLogger,
): Promise<LoadJobPlan[]> {
  void workdir;
  const loaded = await loadSpecForFile(filePath, log);
  return loaded?.jobs ?? [];
}

/**
 * Materialize a document in the reactor when it isn't there yet. Creates an
 * empty document carrying the spec's id + type so subsequent content-scope
 * `loadBatch` jobs have a typed document to apply to. Returns true when a doc
 * was created. No-op (returns false) when the document already exists.
 */
async function materializeIfAbsent(
  client: DriveClient,
  doc: LoadedDoc,
  log?: FsSyncLogger,
): Promise<boolean> {
  const exists = await client.get(doc.header.id).then(
    () => true,
    () => false,
  );
  if (exists) return false;
  const fresh = createSpecDocument(doc.header.documentType) as {
    header: { id: string; name: string; documentType: string };
  };
  fresh.header.id = doc.header.id;
  fresh.header.documentType = doc.header.documentType;
  fresh.header.name = doc.header.name;
  await client.create(fresh as never);
  log?.debug?.(
    `[spec-fs-sync] materialized ${doc.header.documentType} ${doc.header.id}`,
  );
  return true;
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
  deleteNode: (input: { id: string }) => unknown;
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
    _driveActions = {
      addFolder: mod.addFolder,
      addFile: mod.addFile,
      deleteNode: mod.deleteNode,
    };
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
  log?.debug?.(
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
  log?.debug?.(
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
 * Sync each `.phd` path into the embedded reactor and the `vetra` drive:
 *   1. materialize any document the reactor hasn't seen (empty doc, file id+type),
 *   2. replay content-scope operations via a single `loadBatch` (idempotent),
 *   3. attach each doc to the drive under a folder named after its project.
 * Returns the number of content load jobs submitted. Used by the trigger's
 * poll, the `spec-*` write commands, and integration tests.
 *
 * `onLoaded` is invoked once per successfully-loaded spec with its file path
 * and document id — the trigger uses it to maintain a path→docId map for
 * resolving external deletes.
 */
export interface ApplyFsChangesOptions {
  /**
   * `v2-required` (a new cloud Studio): the reactor accepts only signed
   * documents, so the FS is not replayed unsigned. Documents the reactor does
   * not have are created through the client (signed); a legacy file gets a new
   * signed document from its state. Anything that cannot be signed is refused
   * and logged, never submitted (Task 5.SIG, X39).
   */
  signatureMode?: StudioSignatureMode;
}

export async function applyFsChangesToReactor(
  paths: ReadonlyArray<string>,
  workdir: string,
  reactor: Pick<ReactorContext, "client">,
  driveId: string | undefined,
  log?: FsSyncLogger,
  onLoaded?: (filePath: string, docId: string) => void,
  options: ApplyFsChangesOptions = {},
): Promise<number> {
  if (options.signatureMode === "v2-required") {
    return applySignedFsChanges(paths, workdir, reactor, driveId, log, onLoaded);
  }
  const loaded: Array<{
    path: string;
    project: string | undefined;
    spec: LoadedSpec;
  }> = [];
  for (const p of paths) {
    const spec = await loadSpecForFile(p, log);
    if (!spec) continue;
    onLoaded?.(p, spec.doc.header.id);
    loaded.push({ path: p, project: projectForPath(p, workdir), spec });
  }
  if (loaded.length === 0) return 0;

  // 1. Materialize docs the reactor has never created — content ops can't apply
  //    to a non-existent document.
  for (const { spec } of loaded) {
    try {
      await materializeIfAbsent(reactor.client, spec.doc, log);
    } catch (err) {
      log?.error?.(
        `[spec-fs-sync] create failed for ${spec.doc.header.documentType} ${spec.doc.header.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. Replay content operations (dedup by action.id — a no-op for unchanged
  //    files, delta-only for edits).
  const allJobs = loaded.flatMap((l) => l.spec.jobs);
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
    }
  }

  // 3. Attach to the vetra drive under per-project folders.
  if (!driveId) {
    log?.warn?.(
      `[spec-fs-sync] no drive id — materialized ${loaded.length} doc(s) but skipped drive attachment`,
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
        spec.doc.header.id,
        spec.doc.header.name,
        spec.doc.header.documentType,
        folderId,
        log,
      );
    } catch (err) {
      log?.error?.(
        `[spec-fs-sync] drive attach failed for ${spec.doc.header.documentType} "${spec.doc.header.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return allJobs.length;
}

/**
 * Remove a spec doc from the embedded drive: delete its file node, drop the
 * parent-child relationship, then delete the document itself. Idempotent — a
 * missing node, relationship, or document is treated as already-gone and
 * logged at debug, not error.
 */
export async function removeSpecFromDrive(
  reactor: Pick<ReactorContext, "client">,
  driveId: string,
  docId: string,
  log?: FsSyncLogger,
): Promise<void> {
  const client = reactor.client;
  try {
    const nodes = await getDriveNodes(client, driveId);
    if (nodes.some((n) => n.kind === "file" && n.id === docId)) {
      const { deleteNode } = await getDriveActions();
      await client.execute(driveId, "main", [
        deleteNode({ id: docId }) as never,
      ]);
      log?.debug?.(
        `[spec-fs-sync] removed spec node from drive: documentId=${docId} driveId=${driveId}`,
      );
    } else {
      log?.debug?.(
        `[spec-fs-sync] no file node for ${docId} in drive ${driveId} — skipping node delete`,
      );
    }
  } catch (err) {
    log?.debug?.(
      `[spec-fs-sync] deleteNode skipped for ${docId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    await client.removeRelationship(driveId, docId, "child");
  } catch (err) {
    log?.debug?.(
      `[spec-fs-sync] removeRelationship skipped for ${docId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    await client.deleteDocument(docId);
  } catch (err) {
    log?.debug?.(
      `[spec-fs-sync] deleteDocument skipped for ${docId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/* ── Signed sync for a v2-required cloud Studio (Task 5.SIG, X39) ────────── */

interface SignedClient {
  get(id: string): Promise<unknown>;
  create(document: unknown): Promise<unknown>;
  execute(docId: string, scope: string, actions: unknown[]): Promise<unknown>;
  getOperations?(docId: string): Promise<{
    results: Array<{ index?: number; action?: { id?: string; scope?: string } }>;
    next?: () => Promise<unknown>;
  }>;
}

interface OperationLike {
  index?: number;
  action?: { id?: string; scope?: string };
}

/** All operations of a document, grouped by scope (empty without a client). */
export async function operationsByScope(
  client: SignedClient,
  docId: string,
): Promise<Record<string, OperationLike[]>> {
  const byScope: Record<string, OperationLike[]> = {};
  if (!client.getOperations) return byScope;
  type Page = {
    results: OperationLike[];
    next?: () => Promise<unknown>;
  };
  let page: Page | undefined = await client.getOperations(docId);
  while (page) {
    for (const op of page.results) {
      const scope = op.action?.scope ?? "global";
      (byScope[scope] ??= []).push(op);
    }
    page = page.next ? ((await page.next()) as Page) : undefined;
  }
  for (const ops of Object.values(byScope)) {
    ops.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }
  return byScope;
}

/** Write the reactor's (signed) version of a document over its `.phd`. */
export async function mirrorSignedSpec(
  client: SignedClient,
  docId: string,
  projectDir: string,
  log?: FsSyncLogger,
): Promise<string | undefined> {
  const doc = (await client.get(docId)) as {
    header: { name?: string; documentType: string };
  };
  const operations = await operationsByScope(client, docId);
  const path = await saveSpec(
    { ...(doc as unknown as Record<string, unknown>), operations } as never,
    projectDir,
  );
  log?.debug?.(`[spec-fs-sync] mirrored signed ${doc.header.documentType} "${doc.header.name}" → ${path}`);
  return path;
}

async function hasDocument(client: SignedClient, id: string): Promise<boolean> {
  try {
    await client.get(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply `.phd` files to a v2-required reactor. Every write goes through the
 * agent's client, so it is signed; a write that cannot be signed is logged and
 * refused (never submitted unsigned). The files are then rewritten from the
 * signed documents, so a `.phd` in a signed Studio holds signed operations.
 */
async function applySignedFsChanges(
  paths: ReadonlyArray<string>,
  workdir: string,
  reactor: Pick<ReactorContext, "client">,
  driveId: string | undefined,
  log?: FsSyncLogger,
  onLoaded?: (filePath: string, docId: string) => void,
): Promise<number> {
  const client = reactor.client as unknown as SignedClient;
  let synced = 0;
  for (const filePath of paths) {
    const spec = await loadSpecForFile(filePath, log);
    if (!spec) continue;
    const project = projectForPath(filePath, workdir);
    const projectDir = project ? path.join(workdir, project) : workdir;
    let docId = spec.doc.header.id;
    try {
      if (await hasDocument(client, docId)) {
        const existing = await operationsByScope(client, docId);
        for (const [scope, ops] of Object.entries(spec.doc.operations)) {
          if (scope === "document" || !Array.isArray(ops) || ops.length === 0) continue;
          const known = new Set(
            (existing[scope] ?? []).map((op) => op.action?.id).filter(Boolean),
          );
          const actions = ops
            .map((op) => (op as { action?: unknown }).action)
            .filter((action): action is Record<string, unknown> => Boolean(action))
            .filter((action) => !known.has(action.id as string));
          if (actions.length === 0) continue;
          // Signed by the agent's client; throws SignerNotReadyError when the
          // Studio has no delegation yet — then nothing is submitted.
          await client.execute(docId, scope, actions);
        }
      } else if (signaturePolicyOf(spec.doc.header) === "v2-required") {
        // A signed document whose file arrived first (create wrote the file).
        await client.create(spec.doc);
      } else {
        // A legacy file (e.g. `ph generate --extract`): it can never become a
        // v2 document, so a new signed one is built from its state and the
        // file is rewritten under the signed id below.
        const fresh = createSpecDocument(spec.doc.header.documentType, {
          name: spec.doc.header.name,
          initialState: spec.doc.state,
          signaturePolicy: "v2-required",
        });
        await client.create(fresh);
        const previous = docId;
        docId = fresh.header.id;
        log?.info?.(
          `[spec-fs-sync] created signed ${fresh.header.documentType} "${fresh.header.name}" ${docId} from ${previous} (this Studio keeps no unsigned documents).`,
        );
      }
      await mirrorSignedSpec(client, docId, projectDir, log);
      if (driveId) {
        const doc = (await client.get(docId)) as {
          header: { name: string; documentType: string };
        };
        const folderId = await ensureProjectFolder(
          client as never,
          driveId,
          project,
          log,
        );
        await ensureFileNode(
          client as never,
          driveId,
          docId,
          doc.header.name,
          doc.header.documentType,
          folderId,
          log,
        );
      }
      onLoaded?.(filePath, docId);
      synced += 1;
    } catch (err) {
      log?.error?.(
        `[spec-fs-sync] refused ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return synced;
}
