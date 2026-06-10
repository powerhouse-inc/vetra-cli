/**
 * Project derivation for the SPECIFY navigator (pure, unit-testable).
 *
 * Projects are drive folders that contain at least one file whose
 * `documentType` is in `SPECIFY_TYPES`; documents with no resolvable parent
 * folder surface under a synthetic "Ungrouped" project so every document
 * stays reachable. Pure (no React) so it can be tested without a renderer —
 * mirroring `auto-nav.ts`.
 */
import type {
  FileNode,
  FolderNode,
} from "@powerhousedao/shared/document-drive";

export const DOCUMENT_MODEL_TYPE = "powerhouse/document-model";
export const UNGROUPED_PROJECT_ID = "__ungrouped__";
export const UNGROUPED_PROJECT_NAME = "Ungrouped";

/** documentType → display label for builder spec types recognised by the SPECIFY section. */
export const SPECIFY_TYPES: ReadonlyMap<string, string> = new Map([
  [DOCUMENT_MODEL_TYPE, "Document model"],
  ["powerhouse/document-editor", "Document editor"],
  ["powerhouse/processor", "Processor"],
  ["powerhouse/subgraph", "Subgraph"],
  ["powerhouse/app", "App"],
]);

export type ProjectDocument = {
  id: string;
  name: string;
  documentType: string;
};
export type Project = {
  id: string;
  name: string;
  documents: ProjectDocument[];
};

/**
 * Group the drive's spec files by parent folder. Folders with no documents
 * are dropped; orphans (parentFolder null/missing or pointing at a
 * non-folder) go under "Ungrouped". Ordering is deterministic: folders by
 * name (then id on ties), Ungrouped last; documents by name (then id).
 */
export function deriveProjects(
  files: readonly FileNode[],
  folders: readonly FolderNode[],
): Project[] {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const byFolder = new Map<string, ProjectDocument[]>();
  const orphans: ProjectDocument[] = [];

  for (const file of files) {
    if (!SPECIFY_TYPES.has(file.documentType)) continue;
    const doc: ProjectDocument = {
      id: file.id,
      name: file.name,
      documentType: file.documentType,
    };
    const folder = file.parentFolder
      ? folderById.get(file.parentFolder)
      : undefined;
    if (!folder) {
      orphans.push(doc);
      continue;
    }
    const group = byFolder.get(folder.id);
    if (group) group.push(doc);
    else byFolder.set(folder.id, [doc]);
  }

  const byName = (a: { name: string; id: string }, b: typeof a) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  const projects: Project[] = [...byFolder.entries()].map(
    ([id, documents]) => ({
      id,
      name: folderById.get(id)?.name ?? id,
      documents: documents.sort(byName),
    }),
  );
  projects.sort(byName);

  if (orphans.length > 0) {
    projects.push({
      id: UNGROUPED_PROJECT_ID,
      name: UNGROUPED_PROJECT_NAME,
      documents: orphans.sort(byName),
    });
  }
  return projects;
}
