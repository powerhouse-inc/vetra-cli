/**
 * Spec-sync trigger — Vetra-drive → filesystem mirror.
 *
 * Subscribes to spec document changes in the CLI's embedded reactor and
 * writes each doc to disk via `@powerhousedao/vetra/codegen#saveSpec`. The
 * workspace uses one shared drive with a folder per project, and each project
 * folder mirrors to `<workdir>/<project>/specs/<subdir>/`.
 *
 * Today this writes to `<workdir>/specs/<subdir>/` (the workdir-as-single-
 * project case). Routing per project folder needs the drive's folder
 * metadata for each document — follow-up once we read that off the change
 * event payload.
 *
 * This is a one-way mirror. The reverse direction (FS → embedded drive) is
 * not wired up. `ph vetra --watch` from the reactor-project service watches
 * the FS but writes into its own drive, not the embedded one. See
 * HANDOFF.md → "Things NOT done" for the gap.
 */
import { createDocumentChangeTrigger } from "@powerhousedao/ph-clint";
import { saveSpec } from "@powerhousedao/vetra/codegen";

const SPEC_DOC_TYPES = [
  "powerhouse/document-model",
  "powerhouse/document-editor",
  "powerhouse/processor",
  "powerhouse/subgraph",
  "powerhouse/app",
] as const;

interface SpecLogger {
  debug: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function syncSpecsToFs(
  docs: ReadonlyArray<{ header: { documentType: string; name: string } }>,
  workdir: string,
  log?: SpecLogger,
): Promise<void> {
  for (const doc of docs) {
    try {
      const path = await saveSpec(doc as never, workdir);
      log?.debug(
        `[spec-sync] wrote ${doc.header.documentType} "${doc.header.name}" → ${path}`,
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
    await syncSpecsToFs(docs as never, ctx.context.workdir, ctx.context.log);
    // Side-effect-only trigger — no agent work item produced.
    return null;
  },
});
