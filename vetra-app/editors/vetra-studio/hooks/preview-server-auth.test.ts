import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmAuth,
  fetchAuthStatus,
  fetchExportStatus,
  fetchProjectPackage,
  fetchReleaseStatus,
  fetchResolve,
  fetchStart,
  fetchVersion,
  fetchWorkspaceExport,
  logoutAuth,
  OWNER_REQUIRED,
  publishProject,
  setPreviewAuthTokenProvider,
  startAuth,
} from "./preview-server-client.js";

type Call = { url: string; auth: string | null };
let calls: Call[] = [];
let status = 200;
let body: unknown = { authenticated: false, kind: "ok" };

function lastAuth(path: string): string | null | undefined {
  return calls.find((c) => c.url.includes(path))?.auth;
}

beforeEach(() => {
  calls = [];
  status = 200;
  body = { authenticated: false, kind: "ok" };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({
        url,
        auth: new Headers(init?.headers).get("Authorization"),
      });
      if (url.endsWith("studio.config.json")) {
        return Promise.resolve(new Response("{}", { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setPreviewAuthTokenProvider(null);
});

describe("owner-only preview-server calls carry the user's Renown bearer", () => {
  const ownerCalls: Array<[string, () => Promise<unknown>]> = [
    ["/project-package", () => fetchProjectPackage({ project: "p" })],
    ["/release-status", () => fetchReleaseStatus({ project: "p" })],
    ["/publish", () => publishProject({ project: "p" })],
    ["/start", () => fetchStart({ project: "p" })],
    ["/export?workspace=1", () => fetchWorkspaceExport()],
    ["/export/status", () => fetchExportStatus()],
    ["/auth/status", () => fetchAuthStatus()],
    ["/auth/start", () => startAuth()],
    ["/auth/confirm", () => confirmAuth({ waitMs: 0 })],
    ["/auth/logout", () => logoutAuth()],
  ];

  it.each(ownerCalls)("%s sends Authorization: Bearer", async (path, call) => {
    setPreviewAuthTokenProvider(() => Promise.resolve("tok-123"));
    await call();
    expect(lastAuth(path)).toBe("Bearer tok-123");
  });

  it.each(ownerCalls)(
    "%s sends no header when signed out",
    async (path, call) => {
      setPreviewAuthTokenProvider(() => Promise.resolve(undefined));
      await call().catch(() => {});
      expect(lastAuth(path)).toBeNull();
    },
  );

  it("a failing token source still sends the request, unauthenticated", async () => {
    setPreviewAuthTokenProvider(() => Promise.reject(new Error("no renown")));
    await fetchAuthStatus();
    expect(lastAuth("/auth/status")).toBeNull();
  });

  it("public routes don't need the bearer", async () => {
    setPreviewAuthTokenProvider(() => Promise.resolve("tok-123"));
    body = { kind: "no-target" };
    await fetchResolve({ project: "p", doc: "d" });
    body = { vetraCli: "1", ph: "2" };
    await fetchVersion();
    expect(lastAuth("/resolve")).toBeNull();
    expect(lastAuth("/version")).toBeNull();
  });
});

describe("a refused owner call reads as 'sign in as the owner'", () => {
  it("publish and start turn the gate's 401/403 into a failed result", async () => {
    status = 401;
    body = { error: "unauthorized" };
    expect(await publishProject({ project: "p" })).toEqual({
      kind: "failed",
      project: "p",
      error: OWNER_REQUIRED,
    });
    status = 403;
    body = { error: "forbidden" };
    expect(await fetchStart({ project: "p" })).toEqual({
      kind: "failed",
      project: "p",
      error: OWNER_REQUIRED,
    });
  });

  it("publish still passes the agent's own auth-required result through", async () => {
    status = 401;
    body = {
      kind: "auth-required",
      project: "p",
      error: "authorize the agent",
    };
    expect(await publishProject({ project: "p" })).toMatchObject({
      kind: "auth-required",
    });
  });
});
