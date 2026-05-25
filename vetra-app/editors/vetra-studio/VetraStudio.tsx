import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
} from "@powerhousedao/shared/document-drive";
import { useEffect, useState } from "react";
import { ChatPane } from "./ChatPane.js";
import { WorkflowScaffold } from "./WorkflowScaffold.js";

const PREVIEW_URL_STORAGE_KEY = "vetra-studio:build-preview-url";

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
  const [buildPreviewUrl, setBuildPreviewUrl] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(PREVIEW_URL_STORAGE_KEY) ?? "";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (buildPreviewUrl) {
      window.localStorage.setItem(PREVIEW_URL_STORAGE_KEY, buildPreviewUrl);
    } else {
      window.localStorage.removeItem(PREVIEW_URL_STORAGE_KEY);
    }
  }, [buildPreviewUrl]);

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
      <main className="flex flex-1 flex-col overflow-hidden bg-gray-50">
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
          <label
            htmlFor="vetra-studio-preview-url"
            className="text-xs font-medium uppercase tracking-wider text-gray-500"
          >
            Preview URL
          </label>
          <input
            id="vetra-studio-preview-url"
            type="url"
            value={buildPreviewUrl}
            onChange={(event) => setBuildPreviewUrl(event.target.value)}
            placeholder="paste output of spec-preview-show"
            className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-800 focus:border-gray-400 focus:bg-white focus:outline-none"
            spellCheck={false}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          <WorkflowScaffold
            selectedSessionId={selectedSessionId}
            buildPreviewUrl={buildPreviewUrl || undefined}
          />
        </div>
      </main>
    </div>
  );
}
