import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/problem-sheet";
import type {
  ProblemSheetAction,
  ProblemSheetDocument,
} from "document-models/problem-sheet";
import { DocumentSkeletonEditor } from "../vetra-studio/ideation/DocumentSkeletonEditor.js";

export function ProblemSheetEditor({
  document,
  dispatch,
}: {
  document: ProblemSheetDocument;
  dispatch: DocumentDispatch<ProblemSheetAction>;
}) {
  return (
    <DocumentSkeletonEditor
      document={document}
      onRename={(name) => dispatch(actions.setName(name))}
    />
  );
}
