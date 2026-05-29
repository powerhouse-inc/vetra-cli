/**
 * Spec-sync trigger — Vetra-drive → filesystem mirror.
 *
 * Subscribes to spec document changes in the CLI's embedded reactor and writes
 * each doc to disk via `@powerhousedao/vetra/codegen#saveSpec`. The embedded
 * `vetra-cli` drive holds one folder per reactor project; each doc is routed to
 * `<workdir>/<project>/specs/<subdir>/` by reading the doc's file node and its
 * parent folder name (the project) off the drive's node tree.
 *
 * When a doc has no file node yet, or sits at the drive root (the single-
 * project case where `<workdir>` is itself a package), it falls back to
 * `<workdir>/specs/<subdir>/`.
 *
 * Sibling of `spec-fs-sync` (FS → drive). The loop closes via that trigger's
 * `loadBatch`/node dedup — re-feeding a `.phd` it just wrote is a no-op.
 */
import { createDocumentChangeTrigger } from "@powerhousedao/ph-clint";
import path from "node:path";
import { listSpecTypes, saveSpec } from "../commands/spec/registry.js";

// Every spec type the `spec-*` tools can produce: the five codegen builder
// specs plus vetra-app domain models (brand-sheet, feature, …). Mirroring all
// of them keeps drive→FS symmetric with FS→drive.
const SPEC_DOC_TYPES = listSpecTypes();

interface SpecLogger {
  debug: (msg: string) => void;
  warn: (msg: string) => void;
}

interface DriveNode {
  id: string;
  name: string;
  kind: string;
  parentFolder?: string | null;
}

/**
 * Resolve the project directory a doc should be written under, from the drive
 * node tree: locate the doc's file node, walk to its parent folder, and use the
 * folder name as the project subdir. Returns `workdir` itself when the doc
 * isn't filed under a folder.
 */
function projectDirForDoc(
  docId: string,
  workdir: string,
  nodes: ReadonlyArray<DriveNode>,
): string {
  const fileNode = nodes.find((n) => n.kind === "file" && n.id === docId);
  const parentId = fileNode?.parentFolder ?? null;
  if (!parentId) return workdir;
  const folder = nodes.find((n) => n.kind === "folder" && n.id === parentId);
  return folder ? path.join(workdir, folder.name) : workdir;
}

export async function syncSpecsToFs(
  docs: ReadonlyArray<{ header: { id: string; documentType: string; name: string } }>,
  workdir: string,
  opts?: { nodes?: ReadonlyArray<DriveNode>; log?: SpecLogger },
): Promise<void> {
  const nodes = opts?.nodes ?? [];
  const log = opts?.log;
  for (const doc of docs) {
    try {
      const projectDir = projectDirForDoc(doc.header.id, workdir, nodes);
      const written = await saveSpec(doc as never, projectDir);
      log?.debug(
        `[spec-sync] wrote ${doc.header.documentType} "${doc.header.name}" → ${written}`,
      );
    } catch (err) {
      log?.warn(
        `[spec-sync] failed to save "${doc.header.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export const specSyncTrigger = createDocumentChangeTrigger({
  id: "spec-sync",
  // SPEC_DOC_TYPES aren't in the typed registry (which only knows ChatSession),
  // so we widen here. The trigger uses the doc type only as an event filter.
  documentType: SPEC_DOC_TYPES as unknown as string,
  initialReconcile: false,
  async onChange(docs, ctx) {
    const reactor = await ctx.reactor?.();
    const driveId =
      (reactor as { personalDriveId?: string; driveId?: string } | undefined)
        ?.personalDriveId ??
      (reactor as { driveId?: string } | undefined)?.driveId;
    let nodes: DriveNode[] = [];
    if (reactor && driveId) {
      try {
        const drive = (await reactor.client.get(driveId)) as {
          state?: { global?: { nodes?: DriveNode[] } };
        };
        nodes = drive?.state?.global?.nodes ?? [];
      } catch {
        // No drive nodes available — fall back to workdir-root routing.
      }
    }
    await syncSpecsToFs(docs, ctx.context.workdir, {
      nodes,
      log: ctx.context.log,
    });
    // Side-effect-only trigger — no agent work item produced.
    return null;
  },
});
