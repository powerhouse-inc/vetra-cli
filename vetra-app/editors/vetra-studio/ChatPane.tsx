import { isChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import {
  createRemoteAttachmentService,
  type IAttachmentService,
} from "@powerhousedao/reactor-attachments";
import {
  addDocument,
  DEFAULT_SWITCHBOARD_URL,
  useDefaultDrivesUrl,
  usePHToast,
  type DocumentDispatch,
} from "@powerhousedao/reactor-browser";
import { useSafeDocument } from "./SafeDocument.js";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
  FileNode,
} from "@powerhousedao/shared/document-drive";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import VetraMitosis from "./VetraMitosis.js";
import { vetraToolRenderers } from "./tool-renderers/index.js";

const ChatSession = lazy(() =>
  import("@powerhousedao/clint-common/editors").then((m) => ({
    default: m.ChatSession,
  })),
);

const CHAT_SESSION_DOCUMENT_TYPE = "powerhouse/chat-session";

// Animated Vetra logo as the agent avatar; animates while the agent responds.
function AgentMitosisAvatar({
  responding,
  size,
}: {
  responding: boolean;
  size: number;
}) {
  return <VetraMitosis active={responding} size={size} />;
}

export type ChatPaneProps = {
  document: DocumentDriveDocument;
  dispatch: DocumentDispatch<DocumentDriveAction>;
  selectedSessionId: string | undefined;
  onSelectSession: (sessionId: string | undefined) => void;
  /** True once the selected drive has hydrated (node list is authoritative).
   *  Until then a session absent from `nodes` is sync lag, not a missing
   *  record, so "not found" must wait. */
  driveLoaded: boolean;
};

export function ChatPane({
  document,
  selectedSessionId,
  onSelectSession,
  driveLoaded,
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
    // The transport appends `/attachments/<hash>` to remoteUrl verbatim.
    // `source` is the proxied switchboard drive URL `…/switchboard/d/<id>`;
    // keep everything up to and including `/switchboard` so attachment
    // requests stay under the proxy base (`…/switchboard/attachments/<hash>`,
    // which the proxy maps to switchboard `/attachments/<hash>`). Without a
    // `/switchboard` segment (non-proxied switchboard), fall back to origin.
    const source =
      driveRemoteUrl ?? defaultDrivesUrl ?? DEFAULT_SWITCHBOARD_URL;
    const url = new URL(source);
    const sbEnd = url.pathname.indexOf("/switchboard");
    const remoteUrl =
      sbEnd === -1
        ? url.origin
        : url.origin + url.pathname.slice(0, sbEnd + "/switchboard".length);
    return createRemoteAttachmentService({ remoteUrl });
  }, [driveRemoteUrl, defaultDrivesUrl]);

  const { creating, createSession } = useCreateSession(
    document.header.id,
    sessions.length,
    onSelectSession,
  );

  if (selectedSessionId) {
    const knownSession = sessions.find((s) => s.id === selectedSessionId);
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
          <button
            type="button"
            onClick={() => onSelectSession(undefined)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            ← Sessions
          </button>
          <span className="ml-1 min-w-0 truncate text-sm font-medium text-foreground">
            {knownSession?.name ?? ""}
          </span>
          <button
            type="button"
            onClick={() => void createSession()}
            disabled={creating}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg bg-vetra-primary px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-vetra-primary focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<SessionLoading />}>
            <SessionView
              sessionId={selectedSessionId}
              knownInDrive={Boolean(knownSession)}
              driveLoaded={driveLoaded}
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

// Create a chat-session document and route to it. Shared by the list header,
// the empty state, and the session-detail header.
function useCreateSession(
  driveId: string,
  sessionCount: number,
  onCreated: (sessionId: string) => void,
) {
  const [creating, setCreating] = useState(false);
  const toast = usePHToast();

  async function createSession() {
    if (creating) return;
    setCreating(true);
    try {
      const name = `Session ${sessionCount + 1}`;
      const node = await addDocument(driveId, name, CHAT_SESSION_DOCUMENT_TYPE);
      onCreated(node.id);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create session";
      toast?.(message, { type: "error" });
      console.error("Failed to create chat session", err);
    } finally {
      setCreating(false);
    }
  }

  return { creating, createSession };
}

type SessionListProps = {
  driveId: string;
  sessions: FileNode[];
  onSelectSession: (sessionId: string) => void;
};

function SessionList({ driveId, sessions, onSelectSession }: SessionListProps) {
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

  const { creating, createSession } = useCreateSession(
    driveId,
    sessions.length,
    selectSession,
  );

  return (
    <div className="flex h-full flex-col bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Chat sessions
          </h2>
          {sessions.length > 0 ? (
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {sessions.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          data-tour="new-session"
          onClick={() => void createSession()}
          disabled={creating}
          className="inline-flex items-center gap-1 rounded-lg bg-vetra-primary px-2.5 py-1 text-xs font-medium text-vetra-primary-fg shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-vetra-primary focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
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
          onNewSession={() => void createSession()}
          creating={creating}
        />
      ) : (
        <ul className="flex-1 divide-y divide-border/40 overflow-y-auto">
          {sessions.map((session) => {
            const isPending = pendingSessionId === session.id;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => selectSession(session.id)}
                  aria-busy={isPending || undefined}
                  className={
                    "group flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:border-vetra-primary hover:bg-accent focus:outline-none focus-visible:border-vetra-primary focus-visible:bg-accent " +
                    (isPending
                      ? "border-vetra-primary bg-vetra-primary/5"
                      : "border-transparent")
                  }
                >
                  <ChatBubbleIcon
                    className={
                      "h-4 w-4 shrink-0 transition-colors group-hover:text-vetra-primary " +
                      (isPending
                        ? "text-vetra-primary"
                        : "text-muted-foreground")
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
                    <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-border transition-colors group-hover:text-muted-foreground" />
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
        <div className="text-sm font-medium text-foreground">
          What will you build today?
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Start a session to talk to the agent.
        </div>
      </div>
      <button
        type="button"
        onClick={onNewSession}
        disabled={creating}
        className="inline-flex items-center gap-1.5 rounded-lg bg-vetra-primary px-3 py-1.5 text-xs font-medium text-vetra-primary-fg shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-vetra-primary focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
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
  driveLoaded,
  attachments,
}: {
  sessionId: string;
  /** True when the parent located the session in the drive's live node list.
   *  Re-derived each render, so it flips true the moment the session syncs in. */
  knownInDrive: boolean;
  /** True once the drive has hydrated. While false the node list is empty and
   *  `knownInDrive` is meaningless, so a missing session is sync lag. */
  driveLoaded: boolean;
  attachments: IAttachmentService;
}) {
  // useSafeDocument resolves the session without suspending or throwing, so a
  // not-yet-synced session — e.g. one the agent just created — renders a
  // placeholder in place instead of blanking the studio via a parent boundary.
  const { state, document, dispatch } = useSafeDocument(
    sessionId,
    isChatSessionDocument,
  );

  // The document cache doesn't react to `Created` events and may cache a
  // rejected "not found" promise. Once the session appears in the drive's node
  // list, force a refetch so a stale rejection doesn't strand us in error.
  useEffect(() => {
    if (state.status === "error" && knownInDrive) {
      void state.reload();
    }
  }, [state, knownInDrive]);

  if (!document) {
    if (state.status === "error") {
      // "Not found" is honest only once the drive has loaded AND the live node
      // list lacks this id. While the drive is still syncing, or the session is
      // known and we're refetching, keep loading.
      if (driveLoaded && !knownInDrive) {
        return (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            Session not found
          </div>
        );
      }
    }
    return <SessionLoading />;
  }

  return (
    <ChatSession
      document={document}
      dispatch={dispatch}
      attachments={attachments}
      agentAvatar={AgentMitosisAvatar}
      toolRenderers={vetraToolRenderers}
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
