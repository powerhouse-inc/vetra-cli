import type {
  ChatSessionAction,
  ChatSessionDocument,
} from "@powerhousedao/clint-common/document-models/chat-session";
import {
  addDocument,
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
import { lazy, Suspense, useState } from "react";

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

  if (selectedSessionId) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
          <button
            type="button"
            onClick={() => onSelectSession(undefined)}
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            ← Sessions
          </button>
          <span className="ml-1 truncate text-sm font-medium text-gray-800">
            {sessions.find((s) => s.id === selectedSessionId)?.name ?? ""}
          </span>
        </header>
        <div className="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                Loading session…
              </div>
            }
          >
            <SessionView sessionId={selectedSessionId} />
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

  async function handleNewSession() {
    if (creating) return;
    setCreating(true);
    try {
      const name = `Session ${sessions.length + 1}`;
      const node = await addDocument(driveId, name, CHAT_SESSION_DOCUMENT_TYPE);
      onSelectSession(node.id);
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
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-700">Chat sessions</h2>
        <button
          type="button"
          onClick={() => void handleNewSession()}
          disabled={creating}
          className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? "…" : "+ New"}
        </button>
      </header>
      {sessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
          What will you build today?
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                className="block w-full px-4 py-3 text-left text-sm text-gray-800 hover:bg-gray-50"
              >
                {session.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionView({ sessionId }: { sessionId: string }) {
  const [chatDocument, dispatch] = useDocumentById(
    sessionId,
  ) as UseDispatchResult<ChatSessionDocument, ChatSessionAction>;

  if (!chatDocument) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-500">
        Session not found
      </div>
    );
  }

  return <ChatSession document={chatDocument} dispatch={dispatch} />;
}
