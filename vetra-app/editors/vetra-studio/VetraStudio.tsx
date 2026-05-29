import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
} from "@powerhousedao/shared/document-drive";
import { useState } from "react";
import { ChatPane } from "./ChatPane.js";
import { IdeationSection } from "./IdeationSection.js";
import { PhaseCycle } from "./PhaseCycle.js";

export type VetraStudioProps = {
  document: DocumentDriveDocument;
  dispatch: DocumentDispatch<DocumentDriveAction>;
  className?: string;
};

type Section = "home" | "ideate";

export function VetraStudio({
  document,
  dispatch,
  className,
}: VetraStudioProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [section, setSection] = useState<Section>("home");

  const productName =
    document.state.global.name.trim() || document.header.name || "Home";

  return (
    <div className={className ?? "absolute inset-0 flex overflow-hidden"}>
      <aside className="flex w-1/3 min-w-[320px] shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white">
        <ChatPane
          document={document}
          dispatch={dispatch}
          selectedSessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
        />
      </aside>
      <main className="min-h-0 flex-1 overflow-y-auto bg-gray-50">
        {section === "ideate" ? (
          <IdeationSection
            drive={document}
            productName={productName}
            onExitToHome={() => setSection("home")}
          />
        ) : (
          <PhaseCycle onOpenIdeate={() => setSection("ideate")} />
        )}
      </main>
    </div>
  );
}
