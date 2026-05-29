import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/work-breakdown-structure";
import type {
  WorkBreakdownStructureAction,
  WorkBreakdownStructureDocument,
} from "document-models/work-breakdown-structure";
import { DocumentSkeletonEditor } from "../vetra-studio/ideation/DocumentSkeletonEditor.js";

export function WorkBreakdownStructureEditor({
  document,
  dispatch,
}: {
  document: WorkBreakdownStructureDocument;
  dispatch: DocumentDispatch<WorkBreakdownStructureAction>;
}) {
  return (
    <DocumentSkeletonEditor
      document={document}
      onRename={(name) => dispatch(actions.setName(name))}
    />
  );
}
