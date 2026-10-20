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
  StudioProductAction,
  StudioProductDocument,
} from "document-models/studio-product/v1";
import {
  assertIsStudioProductDocument,
  isStudioProductDocument,
} from "./gen/document-schema.js";

/** Hook to get a StudioProduct document by its id */
export function useStudioProductDocumentById(
  documentId: string | null | undefined,
):
  | [StudioProductDocument, DocumentDispatch<StudioProductAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isStudioProductDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected StudioProduct document */
export function useSelectedStudioProductDocument(): [
  StudioProductDocument,
  DocumentDispatch<StudioProductAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsStudioProductDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all StudioProduct documents in the selected drive */
export function useStudioProductDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isStudioProductDocument);
}

/** Hook to get all StudioProduct documents in the selected folder */
export function useStudioProductDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isStudioProductDocument);
}
