import type {
  ChatSessionAction,
  ChatSessionDocument,
} from "@powerhousedao/clint-common/document-models/chat-session";
import {
  useDocumentById,
  type DocumentDispatch,
  type UseDispatchResult,
} from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
} from "@powerhousedao/shared/document-drive";
import { useCallback, useEffect, useRef, useState } from "react";
import { BuildSection } from "./BuildSection.js";
import { ChatPane } from "./ChatPane.js";
import { IdeationSection } from "./IdeationSection.js";
import { PhaseCycle } from "./PhaseCycle.js";
import { useResolvedPreview } from "./hooks/useResolvedPreview.js";
import { useSessionPreviewTarget } from "./hooks/useSessionPreviewTarget.js";

const CHAT_WIDTH_STORAGE_KEY = "vetra-studio:chat-pane-width";
/**
 * URL query param holding the selected chat session id. Using the URL (rather
 * than localStorage) makes the current selection link-shareable across users
 * and tabs, and gives back/forward navigation for free.
 */
const SESSION_QUERY_PARAM = "session";
const CHAT_WIDTH_DEFAULT = 360;
const CHAT_WIDTH_MIN = 240;
/** Minimum width the right pane keeps regardless of how far the divider is pushed. */
const MAIN_PANE_MIN = 320;

function readSessionFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    new URLSearchParams(window.location.search).get(SESSION_QUERY_PARAM) ??
    undefined
  );
}

function writeSessionToUrl(sessionId: string | undefined) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (sessionId) url.searchParams.set(SESSION_QUERY_PARAM, sessionId);
  else url.searchParams.delete(SESSION_QUERY_PARAM);
  /* replaceState rather than pushState so opening a session doesn't flood the
   * history stack — selection within a drive is intra-page state, not
   * navigation. */
  window.history.replaceState(
    window.history.state,
    "",
    url.pathname + url.search + url.hash,
  );
}

export type VetraStudioProps = {
  document: DocumentDriveDocument;
  dispatch: DocumentDispatch<DocumentDriveAction>;
  className?: string;
};

type Section = "home" | "ideate" | "build";

export function VetraStudio({
  document,
  dispatch,
  className,
}: VetraStudioProps) {
  // Initial selection comes from ?session=<id>. We don't validate against the
  // node list here — the persisted node may not be in document.state yet on
  // first render but appear after reactor sync, so we'd lose a valid id.
  // ChatPane already handles the not-found case (renders "Session not found").
  const [selectedSessionId, setSelectedSessionId] = useState<
    string | undefined
  >(() => readSessionFromUrl());
  const [section, setSection] = useState<Section>("home");

  const productName =
    document.state.global.name.trim() || document.header.name || "Home";

  // Keep the URL in sync when we mutate locally (clicks, programmatic).
  useEffect(() => {
    writeSessionToUrl(selectedSessionId);
  }, [selectedSessionId]);

  // Keep local state in sync when the URL changes externally (back/forward,
  // someone editing the address bar, shared link arrives via in-page nav).
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPopState() {
      setSelectedSessionId(readSessionFromUrl());
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /* The session doc is the source of truth for the BUILD preview: its tool
   * history names the project and document the agent last surfaced via
   * `spec-preview-show`. We re-resolve the URL each render from the live
   * preview-server so reactor restarts don't strand the iframe. */
  const [sessionDocument] = useDocumentById(
    selectedSessionId ?? null,
  ) as UseDispatchResult<ChatSessionDocument | undefined, ChatSessionAction>;
  const previewTarget = useSessionPreviewTarget(sessionDocument ?? undefined);
  const preview = useResolvedPreview(previewTarget);

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
    <div
      ref={containerRef}
      className={className ?? "flex h-full w-full overflow-hidden"}
    >
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
        className="group relative flex w-2.5 shrink-0 cursor-col-resize items-center justify-center border-x border-gray-200 bg-white hover:bg-gray-100 active:bg-gray-200"
      >
        <div className="pointer-events-none flex flex-col gap-1">
          <div className="h-1 w-1 rounded-full bg-gray-400 group-hover:bg-gray-700" />
          <div className="h-1 w-1 rounded-full bg-gray-400 group-hover:bg-gray-700" />
          <div className="h-1 w-1 rounded-full bg-gray-400 group-hover:bg-gray-700" />
        </div>
      </div>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50">
        {section === "build" ? (
          <BuildSection
            preview={preview}
            productName={productName}
            onExitToHome={() => setSection("home")}
          />
        ) : section === "ideate" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <IdeationSection
              drive={document}
              productName={productName}
              onExitToHome={() => setSection("home")}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PhaseCycle onOpen={setSection} />
          </div>
        )}
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
