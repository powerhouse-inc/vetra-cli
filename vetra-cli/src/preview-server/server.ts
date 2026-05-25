/**
 * HTTP composition layer.
 *
 * Routes:
 *   GET  /resolve?project=&doc=   read-only; returns JSON `ResolveResult`.
 *   POST /start?project=          idempotent start; returns JSON `StartResult`.
 *   GET  /events                  SSE stream of reactor-project events.
 *   GET  /healthz                 liveness check.
 *
 * Listens on 127.0.0.1 only. CORS is permissive (`*`) for localhost dev —
 * the browser side runs on Connect's port (a different origin) so it needs
 * cross-origin access. Revisit if this server ever leaves the loopback.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { ServiceManager } from "@powerhousedao/ph-clint";
import { PREVIEW_SERVER_HOST } from "./config.js";
import { createSseBroadcaster } from "./events.js";
import { resolvePreview } from "./resolver.js";
import { startPreview } from "./starter.js";

interface PreviewServerDeps {
  services: ServiceManager;
  /** Trigger context exposes `on`; we subscribe once at startup. */
  subscribe: (eventName: string, handler: (raw: unknown) => void) => void;
  workdir: string;
  port: number;
  log?: {
    info: (m: string) => void;
    error: (m: string) => void;
    debug?: (m: string) => void;
  };
}

export interface PreviewServerHandle {
  port: number;
  stop: () => Promise<void>;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(body));
}

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  if (idx === -1) return new URLSearchParams();
  return new URLSearchParams(url.slice(idx + 1));
}

export async function startPreviewServer(
  deps: PreviewServerDeps,
): Promise<PreviewServerHandle> {
  const { services, subscribe, workdir, port, log } = deps;
  const broadcaster = createSseBroadcaster({ subscribe });

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const path = url.split("?")[0];

    try {
      if (path === "/healthz" && method === "GET") {
        writeJson(res, 200, { ok: true });
        return;
      }

      if (path === "/resolve" && method === "GET") {
        const q = parseQuery(url);
        const result = await resolvePreview({
          services,
          workdir,
          project: q.get("project") ?? "",
          doc: q.get("doc") ?? "",
        });
        writeJson(res, 200, result);
        return;
      }

      if (path === "/start" && method === "POST") {
        const q = parseQuery(url);
        const result = await startPreview({
          services,
          workdir,
          project: q.get("project") ?? "",
        });
        const status =
          result.kind === "unknown-project"
            ? 404
            : result.kind === "failed"
              ? 500
              : 202;
        writeJson(res, status, result);
        return;
      }

      if (path === "/events" && method === "GET") {
        broadcaster.attach(res);
        return;
      }

      writeJson(res, 404, { error: "not found", path });
    } catch (err) {
      log?.error(
        `[preview-server] ${method} ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (!res.headersSent) writeJson(res, 500, { error: "internal" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, PREVIEW_SERVER_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  log?.debug?.(`[preview-server] listening on http://${PREVIEW_SERVER_HOST}:${port}`);

  return {
    port,
    stop: async () => {
      broadcaster.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      log?.debug?.("[preview-server] stopped");
    },
  };
}
