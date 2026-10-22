import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Task 1.11: "Authorize agent" is `allowAgent`, self only. A Maker (not an
// ADMINS wallet) may store their own delegation in an org Studio; a Viewer
// may not, and a refused caller never reaches the auth state at all.

const MAKER = "0x00000000000000000000000000000000000000aa";
const VIEWER = "0x00000000000000000000000000000000000000bb";
const OUTSIDER = "0x00000000000000000000000000000000000000cc";

// The console login is the only seam: the real confirmAuth decides whether the
// approved wallet belongs to the caller.
let approver = MAKER;
jest.unstable_mockModule("../../src/auth/login-flow.js", () => ({
  startLogin: () => ({ url: "https://renown.example/console?session=s1", sessionId: "s1" }),
  pollLogin: jest.fn(async () => ({ status: "ready", user: { address: approver } })),
}));

const { startPreviewServer } = await import("../../src/preview-server/server.js");

const MEMBERS = {
  "maker-token": { address: MAKER, name: "Mia", role: "maker" as const, reviewer: false },
  "viewer-token": { address: VIEWER, name: "Vic", role: "viewer" as const, reviewer: false },
};

describe("/auth/* — per-member allowAgent", () => {
  let workdir: string;
  let server: Awaited<ReturnType<typeof startPreviewServer>>;

  const authorizeMember = jest.fn(async (req: { headers: { authorization?: string } }) => {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    if (bearer === "stranger-token") return { ok: false as const, status: 401 as const, error: "unauthorized" };
    if (bearer === "outsider-token") return { ok: false as const, status: 403 as const, error: "forbidden" };
    const member = MEMBERS[bearer as keyof typeof MEMBERS];
    if (!member) return { ok: false as const, status: 401 as const, error: "unauthorized" };
    return { ok: true as const, via: "member" as const, member };
  });

  beforeEach(async () => {
    approver = MAKER;
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-auth-delegation-"));
    server = await startPreviewServer({
      services: { list: () => [], start: jest.fn(), stop: jest.fn() } as never,
      subscribe: () => {},
      workdir,
      renownUrl: "https://renown.example",
      port: 0,
      versions: { vetraCli: "test", ph: "test" },
      cloud: true,
      orgStudio: true,
      authorizeMember,
    });
  });

  afterEach(async () => {
    await server?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function call(method: string, url: string, token?: string) {
    return fetch(`http://127.0.0.1:${server.port}${url}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  it("a non-ADMINS Maker's delegation is accepted (self only)", async () => {
    const started = await call("POST", "/auth/start", "maker-token");
    expect(started.status).toBe(200);
    expect((await started.json()).pending.loginUrl).toContain("session=s1");

    const res = await call("POST", "/auth/confirm?wait=0", "maker-token");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true, address: MAKER });

    // The status route is member-scoped too (reachable by the Maker).
    const status = await call("GET", "/auth/status", "maker-token");
    expect(status.status).toBe(200);
    expect(await status.json()).toHaveProperty("authenticated");
  });

  it("a Maker cannot approve the agent with someone else's wallet", async () => {
    approver = OUTSIDER;
    await call("POST", "/auth/start", "maker-token");
    const res = await call("POST", "/auth/confirm?wait=0", "maker-token");
    expect(await res.json()).toEqual({ authenticated: false, error: "not-you" });
  });

  it("a Viewer cannot store a delegation", async () => {
    const res = await call("POST", "/auth/confirm?wait=0", "viewer-token");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("an outsider and an unauthenticated caller never reach the auth state", async () => {
    expect((await call("POST", "/auth/confirm?wait=0", "outsider-token")).status).toBe(403);
    expect((await call("POST", "/auth/confirm?wait=0", "stranger-token")).status).toBe(401);
    expect((await call("POST", "/auth/confirm?wait=0")).status).toBe(401);
  });

  it("an unknown /auth path is a 404, not an open door", async () => {
    expect((await call("POST", "/auth/whatever", "maker-token")).status).toBe(404);
  });
});
