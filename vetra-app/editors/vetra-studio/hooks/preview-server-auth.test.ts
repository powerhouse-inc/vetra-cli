import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ClientModule from "./preview-server-client.js";

type Client = typeof ClientModule;

/** A fresh client module (its studio.config.json memo starts empty). */
async function loadClient(): Promise<Client> {
  vi.resetModules();
  const client = await import("./preview-server-client.js");
  // Outside vite dev: the client reads studio.config.json (dev skips it).
  client.setPreviewDevModeForTests(false);
  return client;
}

const STUDIO = "https://studio-1.vetra.example";
let config: unknown = { previewServerUrl: `${STUDIO}/preview` };

type Call = { url: string; auth: string | null };
let calls: Call[] = [];
let status = 200;
let body: unknown = { authenticated: false, kind: "ok" };

function lastAuth(path: string): string | null | undefined {
  return calls.find((c) => c.url.includes(path))?.auth;
}

let c: Client;
let auds: string[] = [];

beforeEach(async () => {
  config = { previewServerUrl: `${STUDIO}/preview` };
  auds = [];
  c = await loadClient();
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
        return Promise.resolve(
          config === null
            ? new Response("{}", { status: 404 })
            : new Response(JSON.stringify(config), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function signedIn(token = "tok-123") {
  c.setPreviewAuthTokenProvider((aud) => {
    auds.push(aud);
    return Promise.resolve(token);
  });
}

describe("owner-only preview-server calls carry the user's Renown bearer", () => {
  const ownerCalls: Array<[string, () => Promise<unknown>]> = [
    ["/project-package", () => c.fetchProjectPackage({ project: "p" })],
    ["/release-status", () => c.fetchReleaseStatus({ project: "p" })],
    ["/publish", () => c.publishProject({ project: "p" })],
    ["/start", () => c.fetchStart({ project: "p" })],
    ["/export?workspace=1", () => c.fetchWorkspaceExport()],
    ["/export/status", () => c.fetchExportStatus()],
    ["/auth/status", () => c.fetchAuthStatus()],
    ["/auth/start", () => c.startAuth()],
    ["/auth/confirm", () => c.confirmAuth({ waitMs: 0 })],
    ["/auth/logout", () => c.logoutAuth()],
  ];

  it.each(ownerCalls)("%s sends Authorization: Bearer", async (path, call) => {
    signedIn();
    await call();
    expect(lastAuth(path)).toBe("Bearer tok-123");
    // Bound to this Studio: the aud is its public origin.
    expect(auds).toEqual([STUDIO]);
  });

  it.each(ownerCalls)(
    "%s sends no header when signed out",
    async (path, call) => {
      c.setPreviewAuthTokenProvider(() => Promise.resolve(undefined));
      await call().catch(() => {});
      expect(lastAuth(path)).toBeNull();
    },
  );

  it("a failing token source still sends the request, unauthenticated", async () => {
    c.setPreviewAuthTokenProvider(() => Promise.reject(new Error("no renown")));
    await c.fetchAuthStatus();
    expect(lastAuth("/auth/status")).toBeNull();
  });

  it("never sends a bearer when studio.config.json didn't load (127.0.0.1 fallback)", async () => {
    config = null;
    c = await loadClient();
    signedIn();
    await c.fetchAuthStatus();
    expect(lastAuth("/auth/status")).toBeNull();
    expect(calls.find((x) => x.url.includes("/auth/status"))?.url).toContain(
      "127.0.0.1",
    );
    expect(auds).toEqual([]);
  });

  it("the ambient token is minted from the Connect session with the Studio aud", async () => {
    const getBearerToken = vi.fn(() => Promise.resolve("amb-tok"));
    vi.stubGlobal("window", {
      ph: { renown: { user: { address: "0xa" }, getBearerToken } },
    });
    await c.fetchAuthStatus();
    expect(getBearerToken).toHaveBeenCalledWith({
      expiresIn: 600,
      aud: STUDIO,
    });
    expect(lastAuth("/auth/status")).toBe("Bearer amb-tok");
  });

  it("reuses one ambient token until near expiry; re-mints on a new wallet or sign-out", async () => {
    const getBearerToken = vi.fn(() =>
      Promise.resolve(`amb-${getBearerToken.mock.calls.length}`),
    );
    const renown: {
      user: { address: string } | null;
      getBearerToken: typeof getBearerToken;
    } = {
      user: { address: "0xa" },
      getBearerToken,
    };
    vi.stubGlobal("window", { ph: { renown } });
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    try {
      for (let i = 0; i < 20; i++) await c.fetchAuthStatus();
      expect(getBearerToken).toHaveBeenCalledTimes(1);
      vi.setSystemTime(1_000_000 + 545_000); // inside the refresh margin
      await c.fetchAuthStatus();
      expect(getBearerToken).toHaveBeenCalledTimes(2);
      renown.user = { address: "0xb" };
      await c.fetchAuthStatus();
      expect(getBearerToken).toHaveBeenCalledTimes(3);
      renown.user = null;
      calls = [];
      await c.fetchAuthStatus();
      expect(lastAuth("/auth/status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("public routes don't need the bearer", async () => {
    signedIn();
    body = { kind: "no-target" };
    await c.fetchResolve({ project: "p", doc: "d" });
    body = { vetraCli: "1", ph: "2" };
    await c.fetchVersion();
    expect(lastAuth("/resolve")).toBeNull();
    expect(lastAuth("/version")).toBeNull();
  });
});

describe("a refused owner call reads as 'sign in as the owner'", () => {
  it("publish and start turn the gate's 401/403 into a failed result", async () => {
    status = 401;
    body = { error: "unauthorized" };
    expect(await c.publishProject({ project: "p" })).toEqual({
      kind: "failed",
      project: "p",
      error: c.OWNER_REQUIRED,
    });
    status = 403;
    body = { error: "forbidden" };
    expect(await c.fetchStart({ project: "p" })).toEqual({
      kind: "failed",
      project: "p",
      error: c.OWNER_REQUIRED,
    });
  });

  it("publish still passes the agent's own auth-required result through", async () => {
    status = 401;
    body = {
      kind: "auth-required",
      project: "p",
      error: "authorize the agent",
    };
    expect(await c.publishProject({ project: "p" })).toMatchObject({
      kind: "auth-required",
    });
  });
});
