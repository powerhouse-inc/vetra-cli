import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/feature";
import type { FeatureAction, FeatureDocument } from "document-models/feature";
import { DocumentSkeletonEditor } from "../vetra-studio/ideation/DocumentSkeletonEditor.js";

export function FeatureEditor({
  document,
  dispatch,
}: {
  document: FeatureDocument;
  dispatch: DocumentDispatch<FeatureAction>;
}) {
  return (
    <DocumentSkeletonEditor
      document={document}
      onRename={(name) => dispatch(actions.setName(name))}
    />
  );
}
