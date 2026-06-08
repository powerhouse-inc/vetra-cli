import type {
  ChatSessionAction,
  ChatSessionDocument,
} from "@powerhousedao/clint-common/document-models/chat-session";
import {
  createRemoteAttachmentService,
  type IAttachmentService,
} from "@powerhousedao/reactor-attachments";
import {
  addDocument,
  DEFAULT_SWITCHBOARD_URL,
  useDefaultDrivesUrl,
  useDocumentById,
  usePHToast,
  type DocumentDispatch,
  type UseDispatchResult,
} from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
  FileNode,
} from "@powerhousedao/shared/document-drive";
import { lazy, Suspense, useMemo, useState, useTransition } from "react";
import VetraMitosis from "./VetraMitosis.js";

const ChatSession = lazy(() =>
  import("@powerhousedao/clint-common/editors").then((m) => ({
    default: m.ChatSession,
  })),
);

const CHAT_SESSION_DOCUMENT_TYPE = "powerhouse/chat-session";

export type ChatPaneProps = {
  document: DocumentDriveDocument;
  dispatch: DocumentDispatch<DocumentDriveAction>;
  selectedSessionId: string | undefined;
  onSelectSession: (sessionId: string | undefined) => void;
};

export function ChatPane({
  document,
  selectedSessionId,
  onSelectSession,
}: ChatPaneProps) {
  const sessions = document.state.global.nodes.filter(
    (node): node is FileNode =>
      node.kind === "file" &&
      (node as FileNode).documentType === CHAT_SESSION_DOCUMENT_TYPE,
  );

  const driveRemoteUrl = (
    document.state.local as { remoteUrl?: string } | undefined
  )?.remoteUrl;
  const defaultDrivesUrl = useDefaultDrivesUrl();
  const attachments = useMemo(() => {
    // Switchboard mounts /attachments/* at the host root (not under /graphql),
    // so we need the origin. Prefer the drive's own remoteUrl, fall back to
    // the Connect-configured default drives URL (handles dynamic switchboard
    // ports), then DEFAULT_SWITCHBOARD_URL as a last resort.
    const source =
      driveRemoteUrl ?? defaultDrivesUrl ?? DEFAULT_SWITCHBOARD_URL;
    return createRemoteAttachmentService({
      remoteUrl: new URL(source).origin,
    });
  }, [driveRemoteUrl, defaultDrivesUrl]);

  if (selectedSessionId) {
    const knownSession = sessions.find((s) => s.id === selectedSessionId);
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-vetra-border bg-vetra-card px-3 py-2">
          <button
            type="button"
            onClick={() => onSelectSession(undefined)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-vetra-muted-fg hover:bg-vetra-accent"
          >
            ← Sessions
          </button>
          <span className="ml-1 truncate text-sm font-medium text-vetra-fg">
            {knownSession?.name ?? ""}
          </span>
        </header>
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<SessionLoading />}>
            <SessionView
              sessionId={selectedSessionId}
              knownInDrive={Boolean(knownSession)}
              attachments={attachments}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <SessionList
      driveId={document.header.id}
      sessions={sessions}
      onSelectSession={onSelectSession}
    />
  );
}

type SessionListProps = {
  driveId: string;
  sessions: FileNode[];
  onSelectSession: (sessionId: string) => void;
};

function SessionList({ driveId, sessions, onSelectSession }: SessionListProps) {
  const [creating, setCreating] = useState(false);
  const toast = usePHToast();

  const [, startTransition] = useTransition();
  const [pendingSessionId, setPendingSessionId] = useState<string | undefined>(
    undefined,
  );

  function selectSession(id: string) {
    setPendingSessionId(id);
    startTransition(() => {
      onSelectSession(id);
    });
  }

  async function handleNewSession() {
    if (creating) return;
    setCreating(true);
    try {
      const name = `Session ${sessions.length + 1}`;
      const node = await addDocument(driveId, name, CHAT_SESSION_DOCUMENT_TYPE);
      selectSession(node.id);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create session";
      toast?.(message, { type: "error" });
      console.error("Failed to create chat session", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-vetra-card">
      <header className="flex items-center justify-between gap-3 border-b border-vetra-border bg-vetra-card px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-vetra-fg">
            Chat sessions
          </h2>
          {sessions.length > 0 ? (
            <span className="text-xs font-medium text-vetra-muted-fg tabular-nums">
              {sessions.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void handleNewSession()}
          disabled={creating}
          className="inline-flex items-center gap-1 rounded-lg bg-vetra-primary px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-vetra-primary focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? (
            <span aria-hidden>…</span>
          ) : (
            <>
              <PlusIcon />
              <span>New</span>
            </>
          )}
        </button>
      </header>
      {sessions.length === 0 ? (
        <EmptyState
          onNewSession={() => void handleNewSession()}
          creating={creating}
        />
      ) : (
        <ul className="flex-1 divide-y divide-vetra-border/40 overflow-y-auto">
          {sessions.map((session) => {
            const isPending = pendingSessionId === session.id;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => selectSession(session.id)}
                  aria-busy={isPending || undefined}
                  className={
                    "group flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left text-sm text-vetra-fg transition-colors hover:border-vetra-primary hover:bg-vetra-accent focus:outline-none focus-visible:border-vetra-primary focus-visible:bg-vetra-accent " +
                    (isPending
                      ? "border-vetra-primary bg-vetra-primary/5"
                      : "border-transparent")
                  }
                >
                  <ChatBubbleIcon
                    className={
                      "h-4 w-4 shrink-0 transition-colors group-hover:text-vetra-primary " +
                      (isPending ? "text-vetra-primary" : "text-vetra-muted-fg")
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {session.name}
                  </span>
                  {isPending ? (
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-vetra-primary"
                    />
                  ) : (
                    <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-vetra-border transition-colors group-hover:text-vetra-muted-fg" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyState({
  onNewSession,
  creating,
}: {
  onNewSession: () => void;
  creating: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <VetraMitosis size={48} active={false} />
      <div>
        <div className="text-sm font-medium text-vetra-fg">
          What will you build today?
        </div>
        <div className="mt-1 text-xs text-vetra-muted-fg">
          Start a session to talk to the agent.
        </div>
      </div>
      <button
        type="button"
        onClick={onNewSession}
        disabled={creating}
        className="inline-flex items-center gap-1.5 rounded-lg bg-vetra-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-vetra-primary focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <PlusIcon />
        <span>{creating ? "Creating…" : "New session"}</span>
      </button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden className="h-3 w-3">
      <path
        d="M6 1.5v9M1.5 6h9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <path
        d="M3 3h10a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 12H7.5L4 14.5V12H3a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 3 3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden className={className}>
      <path
        d="m4.5 2.5 3.5 3.5-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SessionView({
  sessionId,
  knownInDrive,
  attachments,
}: {
  sessionId: string;
  /** True when the parent has already located the session in the drive's
   *  node list — meaning a null document from useDocumentById is a transient
   *  subscription lag, not a missing record. False when the id came from a
   *  stale URL / link, in which case "not found" is honest. */
  knownInDrive: boolean;
  attachments: IAttachmentService;
}) {
  const [chatDocument, dispatch] = useDocumentById(
    sessionId,
  ) as UseDispatchResult<ChatSessionDocument, ChatSessionAction>;

  if (!chatDocument) {
    if (knownInDrive) return <SessionLoading />;
    return (
      <div className="flex h-full items-center justify-center text-sm text-vetra-destructive">
        Session not found
      </div>
    );
  }

  return (
    <ChatSession
      document={chatDocument}
      dispatch={dispatch}
      attachments={attachments}
    />
  );
}

function SessionLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <VetraMitosis size={48} active={true} />
    </div>
  );
}
