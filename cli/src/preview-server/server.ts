/**
 * HTTP composition layer.
 *
 * Routes (public = reachable by anyone who can reach the Studio; owner =
 * `authorizeRequest` passes — see request-auth.ts):
 *   GET  /healthz                 public: liveness check.
 *   GET  /version                 public: running vetra + ph versions.
 *   GET  /resolve?doc=            public: preview readiness/URL (or ?drive=, ?home=1).
 *   GET  /events                  public: SSE of reactor-project lifecycle event types.
 *   GET  /export/status           public: whether *this caller* passes the owner gate.
 *   GET  /project-package         owner.
 *   GET  /release-status          owner.
 *   POST /publish                 owner.
 *   GET  /preview/models          owner: what the Preview run loaded (?full=1: with states).
 *   GET  /preview/status          owner: the Preview run's state, with the reason it is not there.
 *   POST /start                   owner: idempotent start of the Preview run.
 *   POST /restart                 owner: stop the Preview run, start it again.
 *   GET  /hosts                   owner: the project's own hosts and which run.
 *   POST /hosts/start?host=       owner: start one (`ph run <host> dev`); answers once under way.
 *   POST /hosts/stop?host=        owner: ask one to stop; answers when it has.
 *
 * Every route acts on the project the Cli works in (the workdir): there is
 * no project to name.
 *   GET  /sessions                owner: list chat sessions.
 *   GET  /sessions/export?id=     owner: zip of a session's doc/thread/log.
 *   GET  /export?workspace=1      owner: zip of selected workspace parts.
 *   GET  /auth/status             owner: the agent's Renown identity.
 *   POST /auth/start|confirm|logout  owner: change the agent's Renown identity.
 *
 * Listens on 127.0.0.1; the Studio SPA calls it directly. A deployment may
 * still put a proxy in front, so every owner route checks the *request's*
 * credential. CORS is `*`: the gate is a bearer header, never an ambient
 * cookie.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { ServiceManager } from "@powerhousedao/clint";
import { PREVIEW_SERVER_HOST, type ResolveResult } from "./config.js";
import { createSseBroadcaster } from "./events.js";
import { readProjectPackage } from "./package-info.js";
import { publishProjectForDeploy } from "./publish-project.js";
import { checkReleaseStatus } from "./release-status.js";
import { resolvePreview } from "./resolver.js";
import { restartPreview, startPreview } from "./starter.js";
import { previewStatus } from "./status.js";
import { createRequestAuthorizer, type RequestAuthorizer } from "./request-auth.js";
import { previewModels } from "../helpers/preview-inspector.js";
import { projectRoot } from "../helpers/project.js";
import { agentDataDir } from "../auth/agent-files.js";
import { localProjectHosts, type ProjectHostsApi } from "../project-hosts/control.js";
import { projectHosts, type ProjectHosts } from "../project-hosts/manager.js";
import { buildSessionExport, listSessions } from "./session-export.js";
import { streamWorkspaceExport, WORKSPACE_ZIP_FILENAME } from "./workspace-export.js";
import type { EmbeddedDrive } from "../helpers/embedded-drive.js";
import {
  confirmAuth,
  getAuthState,
  logoutAuth,
  startAuth,
} from "../auth/renown.js";

interface PreviewServerDeps {
  services: ServiceManager;
  /** Trigger context exposes `on`; we subscribe once at startup. */
  subscribe: (eventName: string, handler: (raw: unknown) => void) => void;
  workdir: string;
  /** Renown server URL the /auth endpoints authenticate against. */
  renownUrl: string;
  /** Configured registry default (config.registryUrl); `resolveRegistryUrl`
   * applies the rest of the precedence (env > project config > built-in). */
  registryUrl?: string;
  port: number;
  /** Running versions surfaced to the studio UI via `GET /version`. */
  versions: { vetraCli: string; ph: string };
  /** Embedded-drive accessor for the /sessions endpoints; undefined = no reactor. */
  getReactor?: () => Promise<EmbeddedDrive | undefined>;
  /** Whether agent conversation logging is on (surfaced in the export metadata). */
  agentLogging?: boolean;
  /** Running as a cloud Studio (`config.environmentId`): no loopback pass. */
  cloud?: boolean;
  /** Renown the owner gate verifies bearers on (the Studio Connect's);
   *  undefined = the SDK default. */
  gateRenownUrl?: string;
  /** The Studio's URL (its Connect's), read per request: its origin is the
   *  `aud` owner bearers must carry. */
  getStudioUrl?: () => string | undefined;
  /** Owner gate override (tests); default `createRequestAuthorizer`. */
  authorizeRequest?: RequestAuthorizer;
  /** The project's hosts (tests); default this process's. */
  projectHosts?: ProjectHosts;
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
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "Content-Disposition",
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

/** `/resolve` is public: drop the absolute project path and raw error text
 * (filesystem paths, stack details) — the studio needs neither to render. */
export function publicResolveResult(result: ResolveResult): PublicResolveResult {
  if (result.kind === "no-target") return result;
  if (result.kind === "unknown-project") {
    return { kind: "unknown-project", error: "unknown project" };
  }
  const rest: Record<string, unknown> = { ...result };
  delete rest.projectPath;
  return rest as PublicResolveResult;
}

export type PublicResolveResult =
  | Exclude<ResolveResult, { projectPath: string }>
  | DistributiveOmit<Extract<ResolveResult, { projectPath: string }>, "projectPath">;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function isTruthyParam(value: string | null): boolean {
  return value !== null && /^(1|true|yes)$/i.test(value);
}

export async function startPreviewServer(
  deps: PreviewServerDeps,
): Promise<PreviewServerHandle> {
  const {
    services,
    subscribe,
    workdir,
    renownUrl,
    registryUrl,
    port,
    versions,
    getReactor,
    agentLogging,
    log,
  } = deps;
  const broadcaster = createSseBroadcaster({ subscribe });
  // One workspace export at a time — each streams the whole workdir.
  let workspaceExportInFlight = false;

  const cloud = deps.cloud ?? Boolean(process.env.VETRA_ENVIRONMENT_ID?.trim());
  const authorizeRequest =
    deps.authorizeRequest ??
    createRequestAuthorizer({
      renownUrl: deps.gateRenownUrl,
      cloud,
      audience: () => deps.getStudioUrl?.(),
      // The store's credential records, then Renown, as every host checks.
      dataDir: agentDataDir(workdir),
    });

  // Owner gate for a route: false (and the 401/403 written) when refused.
  async function requireOwner(
    req: IncomingMessage,
    res: ServerResponse,
    url: string,
  ): Promise<boolean> {
    const check = await authorizeRequest(req, parseQuery(url).get("token"));
    if (check.ok) return true;
    writeJson(res, check.status, { error: check.error });
    return false;
  }

  const hostsManager = deps.projectHosts ?? projectHosts();
  // The project's hosts, or the refusal when the workdir is no project.
  async function hostsApi(): Promise<
    | { api: ProjectHostsApi; manager: ProjectHosts; projectPath: string }
    | { kind: "unknown-project"; error: string }
  > {
    try {
      const projectPath = await projectRoot(workdir);
      return {
        api: localProjectHosts(hostsManager, projectPath),
        manager: hostsManager,
        projectPath,
      };
    } catch {
      return { kind: "unknown-project", error: "unknown project" };
    }
  }

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
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

      if (path === "/version" && method === "GET") {
        writeJson(res, 200, versions);
        return;
      }

      if (path === "/resolve" && method === "GET") {
        const q = parseQuery(url);
        const result = await resolvePreview({
          services,
          workdir,
          doc: q.get("doc") ?? "",
          drive: q.get("drive") ?? undefined,
          home: q.get("home") === "1",
        });
        writeJson(res, 200, publicResolveResult(result));
        return;
      }

      // What the Preview run loaded (its inspector's report); `full=1` adds
      // each version's document model state.
      if (path === "/preview/models" && method === "GET") {
        if (!(await requireOwner(req, res, url))) return;
        let projectPath: string;
        try {
          projectPath = await projectRoot(workdir);
        } catch {
          writeJson(res, 404, { kind: "unknown-project", error: "unknown project" });
          return;
        }
        const q = parseQuery(url);
        writeJson(
          res,
          200,
          previewModels(services, projectPath, { full: q.get("full") === "1" }),
        );
        return;
      }

      // Why the Preview is or is not there; the texts name paths: owner only.
      if (path === "/preview/status" && method === "GET") {
        if (!(await requireOwner(req, res, url))) return;
        writeJson(res, 200, await previewStatus({ services, workdir }));
        return;
      }

      if (path === "/project-package" && method === "GET") {
        if (!(await requireOwner(req, res, url))) return;
        const result = await readProjectPackage(workdir);
        writeJson(res, 200, result);
        return;
      }

      if (path === "/release-status" && method === "GET") {
        if (!(await requireOwner(req, res, url))) return;
        const q = parseQuery(url);
        const result = await checkReleaseStatus({
          workdir,
          registryUrl: q.get("registry") ?? registryUrl,
          renownUrl,
        });
        writeJson(res, 200, result);
        return;
      }

      if (path === "/publish" && method === "POST") {
        if (!(await requireOwner(req, res, url))) return;
        const q = parseQuery(url);
        const result = await publishProjectForDeploy({
          workdir,
          registryUrl: q.get("registry") ?? registryUrl,
          renownUrl,
        });
        const status =
          result.kind === "unknown-project" || result.kind === "no-package"
            ? 404
            : result.kind === "auth-required"
              ? 401
              : result.kind === "failed"
                ? 500
                : 200;
        writeJson(res, status, result);
        return;
      }

      if (path === "/start" && method === "POST") {
        if (!(await requireOwner(req, res, url))) return;
        const result = await startPreview({ services, workdir });
        const status =
          result.kind === "unknown-project"
            ? 404
            : result.kind === "failed"
              ? 500
              : 202;
        writeJson(res, status, result);
        return;
      }

      // Restart can take down a running preview: owner-only, like the exports.
      if (path === "/restart" && method === "POST") {
        if (!(await requireOwner(req, res, url))) return;
        const result = await restartPreview({ services, workdir });
        const status =
          result.kind === "unknown-project"
            ? 404
            : result.kind === "failed"
              ? 500
              : 202;
        writeJson(res, status, result);
        return;
      }

      // The project's own hosts (Preview mode): the texts name paths, and a
      // start or stop acts on the project's stack: owner only.
      if (path === "/hosts" && method === "GET") {
        if (!(await requireOwner(req, res, url))) return;
        const hosts = await hostsApi();
        if ("kind" in hosts) {
          writeJson(res, 404, hosts);
          return;
        }
        writeJson(res, 200, await hosts.api.list());
        return;
      }

      if ((path === "/hosts/start" || path === "/hosts/stop") && method === "POST") {
        if (!(await requireOwner(req, res, url))) return;
        const host = parseQuery(url).get("host");
        if (!host) {
          writeJson(res, 400, { kind: "refused", error: "Name the host: ?host=" });
          return;
        }
        const hosts = await hostsApi();
        if ("kind" in hosts) {
          writeJson(res, 404, hosts);
          return;
        }
        // A start answers once it is under way; the list says how it went.
        const result =
          path === "/hosts/start"
            ? (await hosts.manager.start(hosts.projectPath, host)).result
            : await hosts.api.stop(host);
        const status =
          result.kind === "unknown-host"
            ? 404
            : result.kind === "refused"
              ? 409
              : result.kind === "failed"
                ? 500
                : path === "/hosts/start"
                  ? 202
                  : 200;
        writeJson(res, status, result);
        return;
      }

      if (path === "/events" && method === "GET") {
        broadcaster.attach(res);
        return;
      }

      if (path === "/sessions" && method === "GET") {
        if (!(await requireOwner(req, res, url))) return;
        const drive = await getReactor?.();
        if (!drive) {
          writeJson(res, 503, { error: "reactor-unavailable" });
          return;
        }
        writeJson(res, 200, { kind: "ok", sessions: await listSessions(drive) });
        return;
      }

      if (path === "/sessions/export" && method === "GET") {
        if (!(await requireOwner(req, res, url))) return;
        const q = parseQuery(url);
        const id = q.get("id") ?? "";
        if (!id) {
          writeJson(res, 400, { error: "missing id" });
          return;
        }
        const drive = await getReactor?.();
        if (!drive) {
          writeJson(res, 503, { error: "reactor-unavailable" });
          return;
        }
        const result = await buildSessionExport(drive, workdir, id, {
          versions,
          agentLogging: agentLogging ?? false,
        });
        if (result.kind === "not-found") {
          writeJson(res, 404, { error: "unknown-session", id });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          ...CORS_HEADERS,
        });
        // View over the existing bytes — no copy of the zip payload.
        res.end(Buffer.from(result.zip.buffer, result.zip.byteOffset, result.zip.byteLength));
        return;
      }

      // Whether *this caller* passes the owner gate — lets the studio button
      // say why a download isn't offered instead of failing the fetch.
      if (path === "/export/status" && method === "GET") {
        const check = await authorizeRequest(req, parseQuery(url).get("token"));
        writeJson(res, 200, { authorized: check.ok });
        return;
      }

      // General export: selectable workspace parts, decoupled from any session.
      if (path === "/export" && method === "GET") {
        if (!(await requireOwner(req, res, url))) return;
        const q = parseQuery(url);
        if (!isTruthyParam(q.get("workspace"))) {
          writeJson(res, 400, { error: "no export parts selected", hint: "add ?workspace=1" });
          return;
        }
        if (workspaceExportInFlight) {
          writeJson(res, 409, { error: "export in progress" });
          return;
        }
        workspaceExportInFlight = true;
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${WORKSPACE_ZIP_FILENAME}"`,
          ...CORS_HEADERS,
        });
        try {
          await streamWorkspaceExport(workdir, res);
          res.end();
        } catch (err) {
          log?.error(
            `[preview-server] GET /export: ${err instanceof Error ? err.message : String(err)}`,
          );
          res.destroy();
        } finally {
          workspaceExportInFlight = false;
        }
        return;
      }

      // The agent's session for the studio "Authorize agent" control. They run
      // in this same process as the agent's writes and its whoami/deploy
      // tools, which read the session's files — so confirm here keeps the
      // credential they sign with, and logout withdraws it at once.
      // Owner-only: status names whom the agent acts for, and start /
      // confirm / logout change it.
      if (path === "/auth/status" && method === "GET") {
        if (!(await requireOwner(req, res, url))) return;
        const state = await getAuthState(workdir, renownUrl, { cloud });
        writeJson(res, 200, state);
        return;
      }

      if (path === "/auth/start" && method === "POST") {
        if (!(await requireOwner(req, res, url))) return;
        const state = await startAuth(workdir, renownUrl, { cloud });
        writeJson(res, 200, state);
        return;
      }

      if (path === "/auth/logout" && method === "POST") {
        if (!(await requireOwner(req, res, url))) return;
        const state = await logoutAuth(workdir, renownUrl);
        writeJson(res, 200, state);
        return;
      }

      if (path === "/auth/confirm" && method === "POST") {
        if (!(await requireOwner(req, res, url))) return;
        const q = parseQuery(url);
        const waitMs = Math.min(Math.max(Number(q.get("wait")) || 20000, 0), 60000);
        // A cloud Studio's agent may only act as the owner: a login approved
        // with any other wallet is logged straight back out.
        const state = await confirmAuth(workdir, renownUrl, waitMs, {
          requireAdmin: cloud,
        });
        writeJson(res, 200, state);
        return;
      }

      writeJson(res, 404, { error: "not found", path });
    } catch (err) {
      log?.error(
        `[preview-server] ${method} ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (!res.headersSent) writeJson(res, 500, { error: "internal" });
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, PREVIEW_SERVER_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  log?.debug?.(`[preview-server] listening on http://${PREVIEW_SERVER_HOST}:${port}`);

  const address = server.address();
  return {
    port: address && typeof address === "object" ? address.port : port,
    stop: async () => {
      broadcaster.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      log?.debug?.("[preview-server] stopped");
    },
  };
}
