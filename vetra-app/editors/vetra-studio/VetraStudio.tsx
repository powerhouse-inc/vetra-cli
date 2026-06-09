import type {
  ChatSessionAction,
  ChatSessionDocument,
} from "@powerhousedao/clint-common/document-models/chat-session";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  type DocumentDispatch,
  type UseDispatchResult,
} from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
  FileNode,
} from "@powerhousedao/shared/document-drive";
import { useCallback, useEffect, useRef, useState } from "react";
import { BuildSection } from "./BuildSection.js";
import { ChatPane } from "./ChatPane.js";
import { IdeationSection } from "./IdeationSection.js";
import { PhaseCycle } from "./PhaseCycle.js";
import { SpecifySection } from "./specify/SpecifySection.js";
import { latestTouchedNavigable, sectionForDocumentType } from "./auto-nav.js";
import type { OpenTarget } from "./ideation/types.js";
import { useResolvedPreview } from "./hooks/useResolvedPreview.js";
import { useSessionPreviewTarget } from "./hooks/useSessionPreviewTarget.js";

const CHAT_WIDTH_STORAGE_KEY = "vetra-studio:chat-pane-width";
/**
 * URL query param holding the selected chat session id. Using the URL (rather
 * than localStorage) makes the current selection link-shareable across users
 * and tabs, and gives back/forward navigation for free.
 */
const SESSION_QUERY_PARAM = "session";
/** URL query param holding the open ideation document id. Mirrors the session
 * param so a refresh / shared link restores the open sheet. */
const DOC_QUERY_PARAM = "doc";
/** localStorage key for the auto-follow toggle. A per-user preference (not
 * link-shareable), so localStorage rather than the URL — mirrors chat width. */
const AUTO_NAV_STORAGE_KEY = "vetra-studio:auto-nav";
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

function readDocIdFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    new URLSearchParams(window.location.search).get(DOC_QUERY_PARAM) ??
    undefined
  );
}

function writeDocToUrl(docId: string | undefined) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (docId) url.searchParams.set(DOC_QUERY_PARAM, docId);
  else url.searchParams.delete(DOC_QUERY_PARAM);
  window.history.replaceState(
    window.history.state,
    "",
    url.pathname + url.search + url.hash,
  );
}

/** Resolve `?doc=<id>` against the drive's nodes into an OpenTarget. Returns
 * null if the param is absent or the node isn't (yet) in the drive. */
function resolveDocFromUrl(drive: DocumentDriveDocument): OpenTarget | null {
  const id = readDocIdFromUrl();
  if (!id) return null;
  const node = drive.state.global.nodes.find(
    (n): n is FileNode => n.kind === "file" && n.id === id,
  );
  if (!node) return null;
  return { id: node.id, documentType: node.documentType, name: node.name };
}

export type VetraStudioProps = {
  document: DocumentDriveDocument;
  dispatch: DocumentDispatch<DocumentDriveAction>;
  className?: string;
};

type Section = "home" | "ideate" | "specify" | "build";

/** The section an open document shows in; unknown types keep the legacy
 * IDEATE fallback at restore/user-open sites. */
function sectionForOpenDoc(target: OpenTarget): Section {
  return sectionForDocumentType(target.documentType) ?? "ideate";
}

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
  // Open ideation doc (lifted from IdeationSection so auto-nav can drive it),
  // restored from ?doc= on load. section follows it.
  const [openDoc, setOpenDoc] = useState<OpenTarget | null>(() =>
    resolveDocFromUrl(document),
  );
  const [section, setSection] = useState<Section>(() => {
    const target = resolveDocFromUrl(document);
    return target ? sectionForOpenDoc(target) : "home";
  });
  // userPinned: a manual open pins the view so auto-nav won't yank it away.
  // A doc restored from the URL counts as pinned (the user was looking at it).
  const [userPinned, setUserPinned] = useState<boolean>(
    () => resolveDocFromUrl(document) !== null,
  );
  const [autoNavEnabled, setAutoNavEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(AUTO_NAV_STORAGE_KEY) !== "0";
  });

  // Latest drive, readable from event handlers (popstate) without re-binding.
  const documentRef = useRef(document);
  documentRef.current = document;

  const productName =
    document.state.global.name.trim() || document.header.name || "Home";

  // Keep the URL in sync when we mutate locally (clicks, programmatic).
  useEffect(() => {
    writeSessionToUrl(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    writeDocToUrl(openDoc?.id);
  }, [openDoc]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      AUTO_NAV_STORAGE_KEY,
      autoNavEnabled ? "1" : "0",
    );
  }, [autoNavEnabled]);

  // One place that opens (or clears) a document: keeps openDoc, the pin and
  // the section in lockstep across every entry point (popstate, auto-nav,
  // hydration restore, user click).
  const openDocument = useCallback(
    (target: OpenTarget | null, opts: { pinned: boolean }) => {
      setOpenDoc(target);
      setUserPinned(target !== null && opts.pinned);
      if (target) setSection(sectionForOpenDoc(target));
    },
    [],
  );

  // Keep local state in sync when the URL changes externally (back/forward,
  // someone editing the address bar, shared link arrives via in-page nav).
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPopState() {
      setSelectedSessionId(readSessionFromUrl());
      openDocument(resolveDocFromUrl(documentRef.current), { pinned: true });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [openDocument]);

  // ── Auto-navigation: follow the ideation doc the agent is working on ──
  // useDocumentsInSelectedDrive is reactive: it re-renders when the agent
  // creates OR edits a doc (lastModifiedAtUtcIso bumps). We track the newest
  // touch we've followed (high-water mark) and open the doc whenever a *more
  // recent* touch lands on a *different* doc — so a fast burst of creations
  // followed by spaced-out edits walks the view through each sheet as it fills
  // in. Seed on first observation so we never jump to a pre-existing doc on
  // mount; re-editing the already-open doc doesn't re-trigger.
  const documents = useDocumentsInSelectedDrive();
  const lastTouchedRef = useRef<{ id: string; ts: number } | null>(null);
  const seededRef = useRef(false);
  useEffect(() => {
    if (documents === undefined) return; // drive not loaded yet
    const latest = latestTouchedNavigable(documents);
    // Seed once the drive has loaded — even when empty — so a doc that existed
    // at mount isn't auto-opened, but the first doc created afterwards is.
    if (!seededRef.current) {
      lastTouchedRef.current = latest ? { id: latest.id, ts: latest.ts } : null;
      seededRef.current = true;
      return;
    }
    if (!latest) return;
    const prev = lastTouchedRef.current;
    if (latest.ts <= (prev?.ts ?? -1)) return; // nothing newer happened
    lastTouchedRef.current = { id: latest.id, ts: latest.ts };
    if (latest.id === prev?.id) return; // same doc edited again — already shown
    if (!autoNavEnabled || userPinned) return; // respect toggle + pin
    openDocument(
      { id: latest.id, documentType: latest.documentType, name: latest.name },
      { pinned: false },
    );
  }, [documents, autoNavEnabled, userPinned, openDocument]);

  // Restore `?doc=` once the drive hydrates: the initializer resolves against
  // the node list, which may be empty on first render (nodes arrive after
  // reactor sync). Re-attempt while openDoc is still null and the URL still
  // carries an id — a closed doc clears the param, so this never re-opens a
  // dismissed sheet or fights a manual close.
  useEffect(() => {
    if (openDoc) return;
    const target = resolveDocFromUrl(documentRef.current);
    if (!target) return;
    openDocument(target, { pinned: true });
  }, [documents, openDoc, openDocument]);

  /* The session doc is the source of truth for the BUILD preview: its tool
   * history names the project and document the agent last surfaced via
   * `spec-preview-show`. We re-resolve the URL each render from the live
   * preview-server so reactor restarts don't strand the iframe. */
  const [sessionDocument] = useDocumentById(
    selectedSessionId ?? null,
  ) as UseDispatchResult<ChatSessionDocument | undefined, ChatSessionAction>;
  const previewTarget = useSessionPreviewTarget(sessionDocument ?? undefined);
  const preview = useResolvedPreview(previewTarget);

  // Manual open (a user click) — pins the view against auto-nav.
  const handleUserOpen = useCallback(
    (target: OpenTarget) => openDocument(target, { pinned: true }),
    [openDocument],
  );

  // Breadcrumb section name → back to the list; re-arms auto-follow.
  const handleClearOpen = useCallback(
    () => openDocument(null, { pinned: false }),
    [openDocument],
  );

  // Breadcrumb product name → home; re-arms auto-follow.
  const handleExitToHome = useCallback(() => {
    openDocument(null, { pinned: false });
    setSection("home");
  }, [openDocument]);

  // Toggle handler — turning auto-follow back ON re-arms it (clears the pin).
  const handleToggleAutoNav = useCallback((next: boolean) => {
    setAutoNavEnabled(next);
    if (next) setUserPinned(false);
  }, []);

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
        <AutoNavToggle
          enabled={autoNavEnabled}
          onChange={handleToggleAutoNav}
        />
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
              open={openDoc}
              onOpen={handleUserOpen}
              onClear={handleClearOpen}
              onExitToHome={handleExitToHome}
            />
          </div>
        ) : section === "specify" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SpecifySection
              productName={productName}
              open={openDoc}
              onOpen={handleUserOpen}
              onClear={handleClearOpen}
              onExitToHome={handleExitToHome}
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

/** The auto-follow toggle in the main-pane chrome. */
function AutoNavToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-end border-b border-gray-200 bg-white px-4 py-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        Auto-follow agent
      </label>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
