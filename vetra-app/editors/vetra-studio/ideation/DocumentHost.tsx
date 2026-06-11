import { isAudienceSheetDocument } from "document-models/audience-sheet";
import { isBrandSheetDocument } from "document-models/brand-sheet";
import { isFeatureDocument } from "document-models/feature";
import { isProblemSheetDocument } from "document-models/problem-sheet";
import { isWorkBreakdownStructureDocument } from "document-models/work-breakdown-structure";
import { AudienceSheetEditor } from "../../audience-sheet-editor/AudienceSheetEditor.js";
import { BrandSheetEditor } from "../../brand-sheet-editor/BrandSheetEditor.js";
import { FeatureEditor } from "../../feature-editor/FeatureEditor.js";
import { ProblemSheetEditor } from "../../problem-sheet-editor/ProblemSheetEditor.js";
import { WorkBreakdownStructureEditor } from "../../work-breakdown-structure-editor/WorkBreakdownStructureEditor.js";
import { SafeDocument } from "../SafeDocument.js";

/** Renders the inline editor for a selected document, picked by its type. The
 *  document load is contained per-pane by SafeDocument (no suspend/throw), so a
 *  freshly-created document swaps in without blanking the studio. */
export function DocumentHost({
  id,
  documentType,
}: {
  id: string;
  documentType: string;
}) {
  switch (documentType) {
    case "powerhouse/problem-sheet":
      return (
        <SafeDocument id={id} guard={isProblemSheetDocument}>
          {({ document, dispatch }) => (
            <ProblemSheetEditor document={document} dispatch={dispatch} />
          )}
        </SafeDocument>
      );
    case "powerhouse/audience-sheet":
      return (
        <SafeDocument id={id} guard={isAudienceSheetDocument}>
          {({ document, dispatch }) => (
            <AudienceSheetEditor document={document} dispatch={dispatch} />
          )}
        </SafeDocument>
      );
    case "powerhouse/brand-sheet":
      return (
        <SafeDocument id={id} guard={isBrandSheetDocument}>
          {({ document, dispatch }) => (
            <BrandSheetEditor document={document} dispatch={dispatch} />
          )}
        </SafeDocument>
      );
    case "powerhouse/feature":
      return (
        <SafeDocument id={id} guard={isFeatureDocument}>
          {({ document, dispatch }) => (
            <FeatureEditor document={document} dispatch={dispatch} />
          )}
        </SafeDocument>
      );
    case "powerhouse/work-breakdown-structure":
      return (
        <SafeDocument id={id} guard={isWorkBreakdownStructureDocument}>
          {({ document, dispatch }) => (
            <WorkBreakdownStructureEditor
              document={document}
              dispatch={dispatch}
            />
          )}
        </SafeDocument>
      );
    default:
      return (
        <div className="p-6 text-sm text-gray-500">
          No editor registered for {documentType}.
        </div>
      );
  }
}
