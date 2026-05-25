import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
} from "@powerhousedao/shared/document-drive";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPane } from "./ChatPane.js";
import { WorkflowScaffold } from "./WorkflowScaffold.js";

const PREVIEW_URL_STORAGE_KEY = "vetra-studio:build-preview-url";
const CHAT_WIDTH_STORAGE_KEY = "vetra-studio:chat-pane-width";
const CHAT_WIDTH_DEFAULT = 360;
const CHAT_WIDTH_MIN = 240;
/** Minimum width the right pane keeps regardless of how far the divider is pushed. */
const MAIN_PANE_MIN = 320;

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
  const [chatWidth, setChatWidth] = useState<number>(() => {
    if (typeof window === "undefined") return CHAT_WIDTH_DEFAULT;
    const raw = window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return CHAT_WIDTH_DEFAULT;
    return Math.max(CHAT_WIDTH_MIN, parsed);
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (buildPreviewUrl) {
      window.localStorage.setItem(PREVIEW_URL_STORAGE_KEY, buildPreviewUrl);
    } else {
      window.localStorage.removeItem(PREVIEW_URL_STORAGE_KEY);
    }
  }, [buildPreviewUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(chatWidth));
  }, [chatWidth]);

  const handleResizeMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      const maxWidth = container
        ? Math.max(CHAT_WIDTH_MIN, container.clientWidth - MAIN_PANE_MIN)
        : Number.POSITIVE_INFINITY;
      dragStateRef.current = {
        startX: event.clientX,
        startWidth: chatWidth,
      };
      setIsDragging(true);

      function onMove(e: MouseEvent) {
        const state = dragStateRef.current;
        if (!state) return;
        const next = state.startWidth + (e.clientX - state.startX);
        setChatWidth(clamp(next, CHAT_WIDTH_MIN, maxWidth));
      }
      function onUp() {
        dragStateRef.current = null;
        setIsDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.document.body.style.removeProperty("cursor");
        window.document.body.style.removeProperty("user-select");
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.document.body.style.cursor = "col-resize";
      window.document.body.style.userSelect = "none";
    },
    [chatWidth],
  );

  const handleResizeDoubleClick = useCallback(() => {
    setChatWidth(CHAT_WIDTH_DEFAULT);
  }, []);

  return (
    <div ref={containerRef} className={className ?? "flex h-full w-full"}>
      <aside
        className="flex shrink-0 flex-col bg-white"
        style={{ width: `${chatWidth}px` }}
      >
        <ChatPane
          document={document}
          dispatch={dispatch}
          selectedSessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
        />
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        onMouseDown={handleResizeMouseDown}
        onDoubleClick={handleResizeDoubleClick}
        className="group relative -mx-1 w-2 shrink-0 cursor-col-resize bg-transparent"
      >
        {/* Visible track */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-gray-300 group-hover:bg-gray-500 group-active:bg-gray-700" />
        {/* Grip dots — affordance that this is draggable. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-full bg-gray-400 px-0.5 py-1 opacity-70 group-hover:bg-gray-600 group-hover:opacity-100">
          <div className="h-0.5 w-0.5 rounded-full bg-white" />
          <div className="h-0.5 w-0.5 rounded-full bg-white" />
          <div className="h-0.5 w-0.5 rounded-full bg-white" />
        </div>
      </div>
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
      {isDragging ? (
        /* Catches mouse events that would otherwise route into the BUILD
         * iframe and stall the drag. The overlay is only present while the
         * pointer is held down. */
        <div
          aria-hidden
          className="fixed inset-0 z-50 cursor-col-resize"
          style={{ background: "transparent" }}
        />
      ) : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
