import { useAudienceSheetDocumentById } from "document-models/audience-sheet";
import { useBrandSheetDocumentById } from "document-models/brand-sheet";
import { useFeatureDocumentById } from "document-models/feature";
import { useProblemSheetDocumentById } from "document-models/problem-sheet";
import { useWorkBreakdownStructureDocumentById } from "document-models/work-breakdown-structure";
import { AudienceSheetEditor } from "../../audience-sheet-editor/AudienceSheetEditor.js";
import { BrandSheetEditor } from "../../brand-sheet-editor/BrandSheetEditor.js";
import { FeatureEditor } from "../../feature-editor/FeatureEditor.js";
import { ProblemSheetEditor } from "../../problem-sheet-editor/ProblemSheetEditor.js";
import { WorkBreakdownStructureEditor } from "../../work-breakdown-structure-editor/WorkBreakdownStructureEditor.js";

function Loading() {
  return <div className="p-6 text-sm text-gray-400">Loading document…</div>;
}

function ProblemSheetHost({ id }: { id: string }) {
  const [document, dispatch] = useProblemSheetDocumentById(id);
  if (!document) return <Loading />;
  return <ProblemSheetEditor document={document} dispatch={dispatch} />;
}

function AudienceSheetHost({ id }: { id: string }) {
  const [document, dispatch] = useAudienceSheetDocumentById(id);
  if (!document) return <Loading />;
  return <AudienceSheetEditor document={document} dispatch={dispatch} />;
}

function BrandSheetHost({ id }: { id: string }) {
  const [document, dispatch] = useBrandSheetDocumentById(id);
  if (!document) return <Loading />;
  return <BrandSheetEditor document={document} dispatch={dispatch} />;
}

function FeatureHost({ id }: { id: string }) {
  const [document, dispatch] = useFeatureDocumentById(id);
  if (!document) return <Loading />;
  return <FeatureEditor document={document} dispatch={dispatch} />;
}

function WbsHost({ id }: { id: string }) {
  const [document, dispatch] = useWorkBreakdownStructureDocumentById(id);
  if (!document) return <Loading />;
  return (
    <WorkBreakdownStructureEditor document={document} dispatch={dispatch} />
  );
}

/** Renders the inline editor for a selected document, picked by its type. */
export function DocumentHost({
  id,
  documentType,
}: {
  id: string;
  documentType: string;
}) {
  switch (documentType) {
    case "powerhouse/problem-sheet":
      return <ProblemSheetHost id={id} />;
    case "powerhouse/audience-sheet":
      return <AudienceSheetHost id={id} />;
    case "powerhouse/brand-sheet":
      return <BrandSheetHost id={id} />;
    case "powerhouse/feature":
      return <FeatureHost id={id} />;
    case "powerhouse/work-breakdown-structure":
      return <WbsHost id={id} />;
    default:
      return (
        <div className="p-6 text-sm text-gray-500">
          No editor registered for {documentType}.
        </div>
      );
  }
}
