/**
 * Auto-navigation target selection (pure, unit-testable).
 *
 * The studio watches its drive's file nodes; when the agent (or the user)
 * creates a new ideation document, auto-nav opens it. This module holds the
 * "which document should we navigate to" decision so it can be tested without
 * a React renderer — mirroring `hooks/useSessionPreviewTarget.ts`.
 */
import type { OpenTarget } from "./ideation/types.js";

/** Document types auto-nav will follow — the five ideation sheets (the set
 * `DocumentHost` can render inline). Builder/project specs (document-model,
 * editor, app) belong to the SPECIFY phase and are out of MVP scope. */
export const AUTO_NAV_TYPES: ReadonlySet<string> = new Set([
  "powerhouse/brand-sheet",
  "powerhouse/problem-sheet",
  "powerhouse/audience-sheet",
  "powerhouse/feature",
  "powerhouse/work-breakdown-structure",
]);

/** Minimal structural shape of a drive node we care about. The real drive
 * `nodes` union (FileNode | FolderNode) is assignable to this. */
export type DriveNodeLike = {
  id: string;
  kind: string;
  name: string;
  documentType?: string;
};

/** True for a file node whose type auto-nav follows. */
export function isNavigableFile(
  node: DriveNodeLike,
): node is DriveNodeLike & { documentType: string } {
  return (
    node.kind === "file" &&
    typeof node.documentType === "string" &&
    AUTO_NAV_TYPES.has(node.documentType)
  );
}

/** All navigable file-node ids in a node list — used to seed/refresh the
 * "already seen" set the effect diffs against. */
export function navigableIds(nodes: readonly DriveNodeLike[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) if (isNavigableFile(node)) ids.add(node.id);
  return ids;
}

/**
 * Pick the document to auto-open: the newest navigable node whose id is not in
 * `prevIds`. "Newest" = last in `nodes` (the drive appends new nodes). Returns
 * `null` when nothing navigable was added — including the seed case where every
 * navigable node is already known.
 */
export function pickNewlyCreatedTarget(
  prevIds: ReadonlySet<string>,
  nodes: readonly DriveNodeLike[],
): OpenTarget | null {
  let newest: (DriveNodeLike & { documentType: string }) | null = null;
  for (const node of nodes) {
    if (!isNavigableFile(node)) continue;
    if (prevIds.has(node.id)) continue;
    newest = node; // later wins → newest appended node
  }
  return newest
    ? { id: newest.id, documentType: newest.documentType, name: newest.name }
    : null;
}
