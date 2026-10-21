/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  StudioTeamAction,
  StudioTeamDocument,
} from "document-models/studio-team/v1";
import {
  assertIsStudioTeamDocument,
  isStudioTeamDocument,
} from "./gen/document-schema.js";

/** Hook to get a StudioTeam document by its id */
export function useStudioTeamDocumentById(
  documentId: string | null | undefined,
):
  | [StudioTeamDocument, DocumentDispatch<StudioTeamAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isStudioTeamDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected StudioTeam document */
export function useSelectedStudioTeamDocument(): [
  StudioTeamDocument,
  DocumentDispatch<StudioTeamAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsStudioTeamDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all StudioTeam documents in the selected drive */
export function useStudioTeamDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isStudioTeamDocument);
}

/** Hook to get all StudioTeam documents in the selected folder */
export function useStudioTeamDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isStudioTeamDocument);
}
