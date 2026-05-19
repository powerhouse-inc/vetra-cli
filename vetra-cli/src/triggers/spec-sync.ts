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
 * The reverse direction (FS → drive) is handled by the running
 * reactor-project service: `ph vetra --watch` picks up spec file changes
 * automatically.
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

export const specSyncTrigger = createDocumentChangeTrigger({
  id: "spec-sync",
  // SPEC_DOC_TYPES aren't in the typed registry (which only knows ChatSession),
  // so we widen here. The trigger uses the doc type only as an event filter.
  documentType: SPEC_DOC_TYPES as unknown as string,
  initialReconcile: false,
  async onChange(docs, ctx) {
    const workdir = ctx.context.workdir;
    const log = ctx.context.log;
    for (const doc of docs) {
      try {
        const path = await saveSpec(doc, workdir);
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
    // Side-effect-only trigger — no agent work item produced.
    return null;
  },
});
