// Bundles a chat session's document, Mastra thread, and markdown log into a
// zip for debugging / sharing with support.
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { createWorkdirStore } from "@powerhousedao/ph-clint";
import { getMastraPaths } from "@powerhousedao/ph-clint/mastra";
import { CLI_NAME } from "../config.js";
import type { EmbeddedDrive } from "../helpers/embedded-drive.js";

const CHAT_SESSION_TYPE = "powerhouse/chat-session";

// Loopback resource id the agent loop threads under (ph-clint mastra glue).
const DEFAULT_RESOURCE_ID = "cli-user";

interface DriveNode {
  id: string;
  name?: string;
  kind?: string;
  documentType?: string;
}

interface ChatSessionGlobal {
  threadId?: string | null;
  resourceId?: string | null;
  status?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  agent?: { id?: string; name?: string; model?: string } | null;
}

interface ReactorDoc {
  state?: { global?: Record<string, unknown> };
}

// Minimal reactor client slice this module reads.
interface DriveClient {
  get: (id: string) => Promise<unknown>;
  getOperations?: (id: string) => Promise<OperationsPage>;
}
interface OperationsPage {
  results: unknown[];
  next?: () => Promise<OperationsPage>;
}

export interface SessionSummary {
  id: string;
  name?: string;
  status?: string | null;
  startedAt?: string | null;
  threadId?: string | null;
  agent?: { id?: string; name?: string; model?: string } | null;
}

function driveGlobal(doc: unknown): Record<string, unknown> {
  return (doc as ReactorDoc)?.state?.global ?? {};
}

// List the drive's chat-session documents, enriched from each doc's state.
export async function listSessions(drive: EmbeddedDrive): Promise<SessionSummary[]> {
  const client = drive.reactor.client as unknown as DriveClient;
  const driveDoc = await client.get(drive.driveId);
  const raw = driveGlobal(driveDoc).nodes;
  const nodes = (Array.isArray(raw) ? (raw as DriveNode[]) : []).filter(
    (n) => n.documentType === CHAT_SESSION_TYPE,
  );

  return Promise.all(
    nodes.map(async (node) => {
      let g: ChatSessionGlobal = {};
      try {
        g = driveGlobal(await client.get(node.id));
      } catch {
        // Node listed but doc unreadable — still surface the id/name.
      }
      return {
        id: node.id,
        name: node.name,
        status: g.status ?? null,
        startedAt: g.startedAt ?? null,
        threadId: g.threadId ?? null,
        agent: g.agent ?? null,
      };
    }),
  );
}

async function collectOperations(client: DriveClient, docId: string): Promise<unknown[]> {
  if (!client.getOperations) return [];
  const all: unknown[] = [];
  let page: OperationsPage | undefined = await client.getOperations(docId);
  while (page) {
    all.push(...page.results);
    page = page.next ? await page.next() : undefined;
  }
  return all;
}

// Recall by threadId alone — the doc's resourceId is the session id, not the
// Mastra thread owner, so passing it trips recall's ownership validation.
async function recallThread(workdir: string, threadId: string): Promise<unknown> {
  const store = createWorkdirStore(workdir, CLI_NAME);
  const { dbPath } = getMastraPaths(store);
  if (!existsSync(dbPath)) return undefined;
  const { Memory } = await import("@mastra/memory");
  const { LibSQLStore } = await import("@mastra/libsql");
  const libsql = new LibSQLStore({ id: "ph-clint-storage", url: `file:${dbPath}` });
  try {
    const memory = new Memory({ storage: libsql });
    const { messages } = await memory.recall({ threadId, perPage: false });
    return { threadId, messageCount: messages.length, messages };
  } catch {
    return undefined;
  } finally {
    // Release the libsql client / OS file handles opened for this export.
    await libsql.close().catch(() => {});
  }
}

// Concatenate any markdown logs whose header references this thread id.
async function findMarkdownLog(workdir: string, threadId: string): Promise<string | undefined> {
  const store = createWorkdirStore(workdir, CLI_NAME);
  const logsDir = store.getStoreFolder("logs");
  if (!existsSync(logsDir)) return undefined;
  const marker = `**Session ID**: ${threadId}`;
  const parts: string[] = [];
  try {
    for (const agent of await readdir(logsDir, { withFileTypes: true })) {
      if (!agent.isDirectory()) continue;
      const dir = join(logsDir, agent.name);
      for (const file of await readdir(dir)) {
        if (!file.endsWith(".md")) continue;
        const content = await readFile(join(dir, file), "utf8");
        if (content.includes(marker)) {
          parts.push(`<!-- ${agent.name}/${file} -->\n${content}`);
        }
      }
    }
  } catch {
    return undefined;
  }
  return parts.length ? parts.join("\n\n---\n\n") : undefined;
}

export interface ExportMeta {
  versions: { vetraCli: string; ph: string };
  agentLogging: boolean;
}

export type SessionExportResult =
  | { kind: "ok"; zip: Uint8Array; filename: string }
  | { kind: "not-found" };

export async function buildSessionExport(
  drive: EmbeddedDrive,
  workdir: string,
  sessionId: string,
  meta: ExportMeta,
): Promise<SessionExportResult> {
  const client = drive.reactor.client as unknown as DriveClient;

  let doc: unknown;
  try {
    doc = await client.get(sessionId);
  } catch {
    return { kind: "not-found" };
  }
  if (!doc) return { kind: "not-found" };

  const g = driveGlobal(doc) as ChatSessionGlobal;
  const threadId = g.threadId ?? undefined;
  const resourceId = g.resourceId ?? DEFAULT_RESOURCE_ID;

  const files: Record<string, Uint8Array> = {
    "chat-session.json": strToU8(JSON.stringify(doc, null, 2)),
  };

  const sources: Record<string, boolean> = {
    chatSession: true,
    operations: false,
    mastraThread: false,
    markdownLog: false,
  };

  try {
    const ops = await collectOperations(client, sessionId);
    if (ops.length) {
      files["chat-session-operations.json"] = strToU8(JSON.stringify(ops, null, 2));
      sources.operations = true;
    }
  } catch {
    // op history is best-effort
  }

  if (threadId) {
    const thread = await recallThread(workdir, threadId);
    if (thread) {
      files["mastra-thread.json"] = strToU8(JSON.stringify(thread, null, 2));
      sources.mastraThread = true;
    }
    const md = await findMarkdownLog(workdir, threadId);
    if (md) {
      files["session.md"] = strToU8(md);
      sources.markdownLog = true;
    }
  }

  const metadata = {
    sessionId,
    threadId: threadId ?? null,
    resourceId,
    status: g.status ?? null,
    startedAt: g.startedAt ?? null,
    endedAt: g.endedAt ?? null,
    agent: g.agent ?? null,
    versions: meta.versions,
    agentLogging: meta.agentLogging,
    sources,
    notes: {
      subAgentThreads:
        "not bundled — sub-agent threads (resource cli-user-<agentName>) are " +
        "per-delegation and not attributable to a single session",
      markdownLog: meta.agentLogging
        ? undefined
        : "agentLogging was off — no markdown transcript for this run",
    },
    exportFormat: 1,
  };
  files["metadata.json"] = strToU8(JSON.stringify(metadata, null, 2));

  // Sanitize before it reaches a Content-Disposition header (no quotes/CRLF).
  const safeId = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  return {
    kind: "ok",
    zip: zipSync(files),
    filename: `vetra-session-${safeId}.zip`,
  };
}
