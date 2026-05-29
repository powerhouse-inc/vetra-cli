import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/brand-sheet";
import type {
  BrandSheetAction,
  BrandSheetDocument,
} from "document-models/brand-sheet";
import { DocumentSkeletonEditor } from "../vetra-studio/ideation/DocumentSkeletonEditor.js";

export function BrandSheetEditor({
  document,
  dispatch,
}: {
  document: BrandSheetDocument;
  dispatch: DocumentDispatch<BrandSheetAction>;
}) {
  return (
    <DocumentSkeletonEditor
      document={document}
      onRename={(name) => dispatch(actions.setName(name))}
    />
  );
}
