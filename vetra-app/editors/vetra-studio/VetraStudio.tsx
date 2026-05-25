import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
} from "@powerhousedao/shared/document-drive";
import { useState } from "react";
import { ChatPane } from "./ChatPane.js";
import { WorkflowScaffold } from "./WorkflowScaffold.js";

// Hardcoded so the BUILD card can be exercised before the workflow registry
// supplies a real reactor-project preview URL. Point at a running
// reactor-project's Connect (or any URL that allows iframe embedding).
const DEMO_BUILD_PREVIEW_URL: string | undefined =
  "http://localhost:3000/?embed=1";

export type VetraStudioProps = {
  document: DocumentDriveDocument;
  dispatch: DocumentDispatch<DocumentDriveAction>;
  className?: string;
};

export function VetraStudio({
  document,
  dispatch,
  className,
}: VetraStudioProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string>();

  return (
    <div className={className ?? "flex h-full w-full"}>
      <aside className="flex w-1/3 min-w-[320px] shrink-0 flex-col border-r border-gray-200 bg-white">
        <ChatPane
          document={document}
          dispatch={dispatch}
          selectedSessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
        />
      </aside>
      <main className="flex-1 overflow-y-auto bg-gray-50">
        <WorkflowScaffold
          selectedSessionId={selectedSessionId}
          buildPreviewUrl={DEMO_BUILD_PREVIEW_URL}
        />
      </main>
    </div>
  );
}
