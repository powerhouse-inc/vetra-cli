import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/audience-sheet";
import type {
  AudienceSheetAction,
  AudienceSheetDocument,
} from "document-models/audience-sheet";
import { DocumentSkeletonEditor } from "../vetra-studio/ideation/DocumentSkeletonEditor.js";

export function AudienceSheetEditor({
  document,
  dispatch,
}: {
  document: AudienceSheetDocument;
  dispatch: DocumentDispatch<AudienceSheetAction>;
}) {
  return (
    <DocumentSkeletonEditor
      document={document}
      onRename={(name) => dispatch(actions.setName(name))}
    />
  );
}
