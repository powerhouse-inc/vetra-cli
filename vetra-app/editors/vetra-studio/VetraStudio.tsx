import { isChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import {
  useDocumentSafe,
  type DocumentDispatch,
} from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
  FileNode,
} from "@powerhousedao/shared/document-drive";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentAuthButton } from "./AgentAuthButton.js";
import { BuildSection } from "./BuildSection.js";
import { ChatPane } from "./ChatPane.js";
import { DeploySection } from "./DeploySection.js";
import { IdeationSection } from "./IdeationSection.js";
import { PhaseCycle } from "./PhaseCycle.js";
import { SpecifySection } from "./specify/SpecifySection.js";
import { useProductTour } from "./tour/useProductTour.js";
import { VersionBadge } from "./VersionBadge.js";
import {
  deployFollowAction,
  editFollowAction,
  previewFollowAction,
  sectionForDocumentType,
  type DeployMark,
  type EditMark,
  type PreviewMark,
} from "./auto-nav.js";
import type { OpenTarget } from "./ideation/types.js";
import { useDriveDocuments } from "./hooks/useDriveDocuments.js";
import { useResolvedPreview } from "./hooks/useResolvedPreview.js";
import { useSessionEditedDocument } from "./hooks/useSessionEditedDocument.js";
import { useSessionPreviewTarget } from "./hooks/useSessionPreviewTarget.js";
import {
  useSessionDeployActivity,
  useSessionDeployTarget,
  type DeployTarget,
} from "./hooks/useSessionDeployTarget.js";

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

type Section = "home" | "ideate" | "specify" | "build" | "deploy";

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
  // "Meet the models" product tour, launched from the home overview.
  const { startTour } = useProductTour(setSection);
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

  // Reactive drive documents — restores `?doc=` once the drive hydrates and
  // gates the session-scoped edit-follow on local sync (see below).
  // `undefined` until the drive loads (ChatPane reads it as `driveLoaded`).
  const documents = useDriveDocuments();

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
   * preview-server so reactor restarts don't strand the iframe. Resolve via
   * the non-throwing safe hook so an unsynced `?session=<id>` doesn't suspend
   * or throw the whole studio; read the doc only once it resolves. */
  const sessionState = useDocumentSafe(selectedSessionId ?? null);
  const sessionDocument =
    sessionState.status === "success" &&
    isChatSessionDocument(sessionState.data)
      ? sessionState.data
      : undefined;
  const previewTarget = useSessionPreviewTarget(sessionDocument ?? undefined);
  const preview = useResolvedPreview(previewTarget);
  const deployTarget = useSessionDeployTarget(sessionDocument ?? undefined);
  const deployActivity = useSessionDeployActivity(sessionDocument ?? undefined);

  // ── Auto-navigation: follow the doc the SELECTED session's agent edits ──
  // Derived from that session's transcript (spec-create/spec-update results),
  // so an edit in another session never moves the view. A new edit (keyed by
  // the tool-result callId) opens its doc; `editFollowAction` holds the rules
  // and seeds per session so switching sessions doesn't yank. We park the
  // target and open only once the doc has synced into the drive — the
  // transcript can name a doc before reactor-browser syncs it, and opening
  // early crashes the editor host ("Document not found").
  const editTarget = useSessionEditedDocument(sessionDocument ?? undefined);
  const editMarkRef = useRef<EditMark | null>(null);
  const [pendingEditFollow, setPendingEditFollow] = useState<OpenTarget | null>(
    null,
  );
  useEffect(() => {
    const { mark, open } = editFollowAction(
      {
        sessionId: sessionDocument?.header.id ?? null,
        callId: editTarget?.callId ?? null,
        target: editTarget
          ? {
              id: editTarget.id,
              documentType: editTarget.documentType,
              name: editTarget.name,
            }
          : null,
      },
      editMarkRef.current,
      { autoNavEnabled, userPinned, openDocId: openDoc?.id ?? null },
    );
    if (mark) editMarkRef.current = mark;
    if (open) setPendingEditFollow(open);
  }, [sessionDocument, editTarget, autoNavEnabled, userPinned, openDoc]);

  // Open the parked edit-follow target once the doc is local; re-check guards
  // at open time (the user may have pinned or toggled off while it synced).
  useEffect(() => {
    if (!pendingEditFollow) return;
    if (!documents?.some((d) => d.header.id === pendingEditFollow.id)) return;
    if (!autoNavEnabled || userPinned || pendingEditFollow.id === openDoc?.id) {
      setPendingEditFollow(null);
      return;
    }
    openDocument(pendingEditFollow, { pinned: false });
    setPendingEditFollow(null);
  }, [
    documents,
    pendingEditFollow,
    autoNavEnabled,
    userPinned,
    openDoc,
    openDocument,
  ]);

  // ── Auto-navigation: follow the preview the agent surfaces ──
  // A spec-preview-show is the agent explicitly showing the user something —
  // switch to BUILD when a NEW show lands (keyed by toolCallId, so re-showing
  // the same target counts). Seeded per session once its transcript resolves,
  // so a show already in the transcript at load/session-switch doesn't yank
  // the view; `previewFollowAction` holds the decision rules.
  const previewMarkRef = useRef<PreviewMark | null>(null);
  useEffect(() => {
    const { mark, navigate } = previewFollowAction(
      {
        sessionId: sessionDocument?.header.id ?? null,
        callId: previewTarget?.callId ?? null,
      },
      previewMarkRef.current,
      { autoNavEnabled, userPinned },
    );
    if (mark) previewMarkRef.current = mark;
    if (navigate) {
      // Clear any auto-opened doc so openDoc and section stay in lockstep.
      openDocument(null, { pinned: false });
      setSection("build");
    }
  }, [
    sessionDocument,
    previewTarget,
    autoNavEnabled,
    userPinned,
    openDocument,
  ]);

  // ── Auto-navigation: follow the project the agent is deploying ──
  // Same per-session new-callId decision as the preview-follow (shared via
  // `deployFollowAction`), but the signal is the agent's own deploy commands
  // — there's no explicit "show". A new deploy call switches to DEPLOY and
  // hands the target down to DeploySection, which resolves it to a project.
  const deployMarkRef = useRef<DeployMark | null>(null);
  const [deployFocus, setDeployFocus] = useState<DeployTarget | null>(null);
  useEffect(() => {
    const { mark, navigate } = deployFollowAction(
      {
        sessionId: sessionDocument?.header.id ?? null,
        callId: deployTarget?.callId ?? null,
      },
      deployMarkRef.current,
      { autoNavEnabled, userPinned },
    );
    if (mark) deployMarkRef.current = mark;
    if (navigate && deployTarget) {
      // Clear any auto-opened doc so openDoc and section stay in lockstep.
      openDocument(null, { pinned: false });
      setSection("deploy");
      setDeployFocus(deployTarget);
    }
  }, [sessionDocument, deployTarget, autoNavEnabled, userPinned, openDocument]);

  // Drop a consumed deploy focus once we leave DEPLOY. DeploySection's
  // applied-once guard is component-local and resets when it unmounts, so a
  // lingering focus would re-open the last deployed project when the user
  // returns to DEPLOY manually. A fresh deploy re-sets focus in the same batch
  // as section="deploy", so this never clears the target we just navigated to.
  useEffect(() => {
    if (section !== "deploy") setDeployFocus(null);
  }, [section]);

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
        className="flex shrink-0 flex-col bg-vetra-card"
        style={{ width: `${chatWidth}px` }}
      >
        <ChatPane
          document={document}
          dispatch={dispatch}
          selectedSessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
          driveLoaded={documents !== undefined}
        />
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        onMouseDown={handleResizeMouseDown}
        onDoubleClick={handleResizeDoubleClick}
        className="group relative flex w-2.5 shrink-0 cursor-col-resize items-center justify-center border-x border-vetra-border bg-vetra-card hover:bg-vetra-accent active:bg-vetra-muted"
      >
        <div className="pointer-events-none flex flex-col gap-1">
          <div className="h-1 w-1 rounded-full bg-vetra-border group-hover:bg-vetra-muted-fg" />
          <div className="h-1 w-1 rounded-full bg-vetra-border group-hover:bg-vetra-muted-fg" />
          <div className="h-1 w-1 rounded-full bg-vetra-border group-hover:bg-vetra-muted-fg" />
        </div>
      </div>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-vetra-accent">
        <AutoNavToggle
          enabled={autoNavEnabled}
          paused={userPinned}
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
        ) : section === "deploy" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DeploySection
              productName={productName}
              onExitToHome={handleExitToHome}
              focus={deployFocus}
              deployActivity={deployActivity}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PhaseCycle onOpen={setSection} onStartTour={startTour} />
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

/** The auto-follow toggle in the main-pane chrome. A pin (manually opened
 * doc) suppresses auto-follow while the toggle stays on — surface that state
 * so "not navigating" reads as paused, not broken. */
function AutoNavToggle({
  enabled,
  paused,
  onChange,
}: {
  enabled: boolean;
  paused: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-vetra-border bg-vetra-card px-4 py-1.5 min-h-10">
      <VersionBadge />
      <div className="flex-1" />
      <AgentAuthButton />
      {enabled && paused ? (
        <span className="text-[11px] text-vetra-muted-fg">
          paused — close the document to resume
        </span>
      ) : null}
      <label className="flex cursor-pointer items-center gap-2 text-xs text-vetra-muted-fg">
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
