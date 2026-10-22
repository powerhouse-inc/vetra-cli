/**
 * HTTP composition layer.
 *
 * Routes (public = reachable by anyone who can reach the Studio; owner =
 * `authorizeRequest` passes — see request-auth.ts):
 *   GET  /healthz                 public: liveness check.
 *   GET  /version                 public: running vetra + ph versions.
 *   GET  /resolve?project=&doc=   public: preview readiness/URL (or &drive=, &home=1).
 *   GET  /events                  public: SSE of reactor-project lifecycle event types.
 *   GET  /export/status           public: whether *this caller* passes the owner gate.
 *   GET  /project-package         owner.
 *   GET  /release-status          owner.
 *   POST /publish                 owner.
 *   POST /start?project=          owner: idempotent start.
 *   POST /restart?project=        owner: stop the preview, start it again.
 *   GET  /sessions                owner: list chat sessions.
 *   GET  /sessions/export?id=     owner: zip of a session's doc/thread/log.
 *   GET  /export?workspace=1      owner: zip of selected workspace parts.
 *   GET  /auth/status             owner: the agent's Renown identity.
 *   POST /auth/start|confirm|logout  owner: change the agent's Renown identity.
 *
 * Listens on 127.0.0.1, but the embedded proxy exposes it publicly at
 * `/preview` — so every owner route checks the *request's* credential.
 * CORS is `*`: the gate is a bearer header, never an ambient cookie.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { ServiceManager } from "@powerhousedao/ph-clint";
import { PREVIEW_SERVER_HOST, type ResolveResult } from "./config.js";
import { createSseBroadcaster } from "./events.js";
import { readProjectPackage } from "./package-info.js";
import { publishProjectForDeploy } from "./publish-project.js";
import { checkReleaseStatus } from "./release-status.js";
import { resolvePreview } from "./resolver.js";
import { restartPreview, startPreview } from "./starter.js";
import {
  createCapabilityGate,
  createRequestAuthorizer,
  type AcceptedMemberCheck,
  type MemberAuthorizer,
  type RequestAuthorizer,
} from "./request-auth.js";
import { routeCapability } from "./route-capabilities.js";
import type { TeamRoutes } from "./team-routes.js";
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
  /** Live public proxy origin, forwarded to reactor-project starts. */
  proxyPublicUrl?: string;
  /** Running versions surfaced to the studio UI via `GET /version`. */
  versions: { vetraCli: string; ph: string };
  /** Embedded-drive accessor for the /sessions endpoints; undefined = no reactor. */
  getReactor?: () => Promise<EmbeddedDrive | undefined>;
  /** Whether agent conversation logging is on (surfaced in the export metadata). */
  agentLogging?: boolean;
  /** Running as a cloud Studio (`config.environmentId`): no loopback pass. */
  cloud?: boolean;
  /** The Studio belongs to an organisation: one delegation per member (1.11). */
  orgStudio?: boolean;
  /** Renown the owner gate verifies bearers on (the Studio Connect's);
   *  undefined = the SDK default. */
  gateRenownUrl?: string;
  /** Live public proxy URL; its origin is the `aud` owner bearers must carry.
   *  Falls back to `proxyPublicUrl`. */
  getProxyPublicUrl?: () => string | undefined;
  /** Owner gate override (tests); default `createRequestAuthorizer`. */
  authorizeRequest?: RequestAuthorizer;
  /** Member gate (org Studios / team routes); default: absent (owner gate only). */
  authorizeMember?: MemberAuthorizer;
  /** Team route handlers; absent = team routes answer 404. */
  teamRoutes?: TeamRoutes;
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
    return { kind: "unknown-project", project: result.project, error: "unknown project" };
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
    proxyPublicUrl,
    versions,
    getReactor,
    agentLogging,
    log,
  } = deps;
  const broadcaster = createSseBroadcaster({ subscribe });
  // One workspace export at a time — each streams the whole workdir.
  let workspaceExportInFlight = false;

  const cloud = deps.cloud ?? Boolean(process.env.VETRA_ENVIRONMENT_ID?.trim());
  const orgStudio = deps.orgStudio ?? false;
  const authorizeRequest =
    deps.authorizeRequest ??
    createRequestAuthorizer({
      renownUrl: deps.gateRenownUrl,
      cloud,
      audience: () => deps.getProxyPublicUrl?.() ?? proxyPublicUrl,
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

  const capabilityGate = deps.authorizeMember
    ? createCapabilityGate({ authorizeMember: deps.authorizeMember })
    : undefined;
  const teamRoutes = deps.teamRoutes;

  /** Capability gate when members are wired; the owner gate otherwise (S1 tests). */
  async function requireCapability(
    req: IncomingMessage,
    res: ServerResponse,
    url: string,
    cap: Parameters<NonNullable<typeof capabilityGate>>[3],
    ctx?: Parameters<NonNullable<typeof capabilityGate>>[4],
  ): Promise<boolean> {
    if (!capabilityGate) return requireOwner(req, res, url);
    return (await capabilityGate(req, res, url, cap, ctx)) !== null;
  }

  /**
   * Like `requireCapability`, but hands the accepted caller back. Without the
   * member gate (a local Studio, the S1 tests) the owner gate counts as the
   * admin-side path: `member: null`.
   */
  async function requireMemberCapability(
    req: IncomingMessage,
    res: ServerResponse,
    url: string,
    cap: Parameters<NonNullable<typeof capabilityGate>>[3],
  ): Promise<AcceptedMemberCheck | null> {
    if (!capabilityGate) {
      return (await requireOwner(req, res, url)) ? { ok: true, via: "operator", member: null } : null;
    }
    return capabilityGate(req, res, url, cap);
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
      // Team routes (task 1.9): the route table decides the capability, the
      // gate enforces it, and the handler sees the accepted member.
      if (path.startsWith("/team/")) {
        const cap = routeCapability(method, path);
        if (!cap || cap === "public" || !capabilityGate || !teamRoutes) {
          writeJson(res, 404, { error: "not found", path });
          return;
        }
        const changeId = parseQuery(url).get("changeId") ?? undefined;
        // Guests may see themselves on their change; the member list is members-only.
        const ctx = path === "/team/members" ? {} : { changeId };
        const check = await capabilityGate(req, res, url, cap, ctx);
        if (!check) return;
        await teamRoutes.handle({ req, res, url, method, check });
        return;
      }

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
          project: q.get("project") ?? "",
          doc: q.get("doc") ?? "",
          drive: q.get("drive") ?? undefined,
          home: q.get("home") === "1",
          proxyPublicUrl,
        });
        writeJson(res, 200, publicResolveResult(result));
        return;
      }

      if (path === "/project-package" && method === "GET") {
        if (!(await requireCapability(req, res, url, "exportWorkspace"))) return;
        const q = parseQuery(url);
        const result = await readProjectPackage(workdir, q.get("project") ?? "");
        writeJson(res, 200, result);
        return;
      }

      if (path === "/release-status" && method === "GET") {
        if (!(await requireCapability(req, res, url, "exportWorkspace"))) return;
        const q = parseQuery(url);
        const result = await checkReleaseStatus({
          workdir,
          project: q.get("project") ?? "",
          registryUrl: q.get("registry") ?? registryUrl,
          renownUrl,
        });
        writeJson(res, 200, result);
        return;
      }

      if (path === "/publish" && method === "POST") {
        if (!(await requireCapability(req, res, url, "launch"))) return;
        const q = parseQuery(url);
        const result = await publishProjectForDeploy({
          workdir,
          project: q.get("project") ?? "",
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
        if (!(await requireCapability(req, res, url, "startChange"))) return;
        const q = parseQuery(url);
        const result = await startPreview({
          services,
          workdir,
          project: q.get("project") ?? "",
          proxyPublicUrl,
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

      // Restart can take down a running preview: owner-only, like the exports.
      if (path === "/restart" && method === "POST") {
        if (!(await requireCapability(req, res, url, "exportWorkspace"))) return;
        const q = parseQuery(url);
        const result = await restartPreview({
          services,
          workdir,
          project: q.get("project") ?? "",
          proxyPublicUrl,
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

      if (path === "/sessions" && method === "GET") {
        if (!(await requireCapability(req, res, url, "exportWorkspace"))) return;
        const drive = await getReactor?.();
        if (!drive) {
          writeJson(res, 503, { error: "reactor-unavailable" });
          return;
        }
        writeJson(res, 200, { kind: "ok", sessions: await listSessions(drive) });
        return;
      }

      if (path === "/sessions/export" && method === "GET") {
        if (!(await requireCapability(req, res, url, "exportWorkspace"))) return;
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
        if (!(await requireCapability(req, res, url, "exportWorkspace"))) return;
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

      // "Authorize agent" for the caller (P6-4): `allowAgent` is Owners and
      // Makers, self only. These routes run in the same process as the agent's
      // whoami/deploy tools, so confirm here stores the credential the tools
      // read. An org Studio keeps one delegation per member (keyed by their
      // address); a personal Studio keeps the single owner identity.
      if (path.startsWith("/auth/")) {
        const check = await requireMemberCapability(req, res, url, "allowAgent");
        if (!check) return;
        const target = orgStudio && check.member ? { member: check.member.address } : {};

        if (path === "/auth/status" && method === "GET") {
          writeJson(res, 200, await getAuthState(workdir, renownUrl, target));
          return;
        }
        if (path === "/auth/start" && method === "POST") {
          writeJson(res, 200, await startAuth(workdir, renownUrl, target));
          return;
        }
        if (path === "/auth/logout" && method === "POST") {
          writeJson(res, 200, await logoutAuth(workdir, renownUrl, target));
          return;
        }
        if (path === "/auth/confirm" && method === "POST") {
          const q = parseQuery(url);
          const waitMs = Math.min(Math.max(Number(q.get("wait")) || 20000, 0), 60000);
          // A member's login is kept only under their own address; where the
          // single-identity owner rule applies, only the owner's wallet is kept.
          writeJson(
            res,
            200,
            await confirmAuth(workdir, renownUrl, waitMs, {
              ...target,
              // Where a member's own delegation is the rule (an org Studio),
              // ADMINS is empty and must not be consulted.
              requireAdmin: cloud && !orgStudio,
            }),
          );
          return;
        }
        writeJson(res, 404, { error: "not found", path });
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
