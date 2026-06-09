/**
 * Project derivation for the SPECIFY navigator (pure, unit-testable).
 *
 * Projects are the drive folders that contain at least one
 * `powerhouse/document-model` file; models with no resolvable parent folder
 * surface under a synthetic "Ungrouped" project so every model stays
 * reachable. Pure (no React) so it can be tested without a renderer —
 * mirroring `auto-nav.ts`.
 */
import type {
  FileNode,
  FolderNode,
} from "@powerhousedao/shared/document-drive";

export const DOCUMENT_MODEL_TYPE = "powerhouse/document-model";
export const UNGROUPED_PROJECT_ID = "__ungrouped__";
export const UNGROUPED_PROJECT_NAME = "Ungrouped";

export type ProjectModel = { id: string; name: string };
export type Project = { id: string; name: string; models: ProjectModel[] };

/**
 * Group the drive's document-model files by parent folder. Folders with no
 * models are dropped; orphans (parentFolder null/missing or pointing at a
 * non-folder) go under "Ungrouped". Ordering is deterministic: folders by
 * name (then id on ties), Ungrouped last; models by name (then id).
 */
export function deriveProjects(
  files: readonly FileNode[],
  folders: readonly FolderNode[],
): Project[] {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const byFolder = new Map<string, ProjectModel[]>();
  const orphans: ProjectModel[] = [];

  for (const file of files) {
    if (file.documentType !== DOCUMENT_MODEL_TYPE) continue;
    const model: ProjectModel = { id: file.id, name: file.name };
    const folder = file.parentFolder
      ? folderById.get(file.parentFolder)
      : undefined;
    if (!folder) {
      orphans.push(model);
      continue;
    }
    const group = byFolder.get(folder.id);
    if (group) group.push(model);
    else byFolder.set(folder.id, [model]);
  }

  const byName = (a: { name: string; id: string }, b: typeof a) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  const projects: Project[] = [...byFolder.entries()].map(([id, models]) => ({
    id,
    name: folderById.get(id)?.name ?? id,
    models: models.sort(byName),
  }));
  projects.sort(byName);

  if (orphans.length > 0) {
    projects.push({
      id: UNGROUPED_PROJECT_ID,
      name: UNGROUPED_PROJECT_NAME,
      models: orphans.sort(byName),
    });
  }
  return projects;
}
