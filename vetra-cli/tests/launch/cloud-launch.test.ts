import { describe, expect, it, jest } from "@jest/globals";
import { randomBytes } from "node:crypto";
import {
  cloudLaunch,
  cloudRollback,
  ensureProduct,
  STUDIO_SECRET_ENV,
  STUDIO_SECRET_HEADER,
  type CloudContext,
} from "../../src/launch/cloud-launch.js";
import { isPermissionError, LaunchError } from "../../src/launch/errors.js";

const SWITCHBOARD = "https://switchboard.example.test";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: { query: string; variables: Record<string, unknown> };
}

function harness(respond: (c: Captured) => { status?: number; json: unknown }) {
  const secret = randomBytes(32).toString("hex");
  const bearer = randomBytes(24).toString("hex");
  const calls: Captured[] = [];
  const lines: string[] = [];
  const logLine = (msg: string) => {
    lines.push(msg);
  };
  const fetchFn = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const c: Captured = {
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    };
    calls.push(c);
    const r = respond(c);
    return new Response(JSON.stringify(r.json), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  const ctx: CloudContext = {
    workdir: "/nowhere",
    config: { cloudSwitchboardUrl: SWITCHBOARD, environmentId: "studio-env-1" },
    log: { info: logLine, warn: logLine, error: logLine, debug: logLine },
    fetch: fetchFn,
    bearerToken: async () => bearer,
    env: { [STUDIO_SECRET_ENV]: secret },
  };
  return { ctx, calls, lines, secret, bearer };
}

const input = {
  appId: "app-1",
  versionNumber: 3,
  sha: "abc123",
  gitTag: "v3",
  packages: [{ name: "@vetra-apps/team-todo", version: "1.0.4" }],
};

describe("cloudLaunch", () => {
  it("cloudLaunch sends the studio secret header and never logs it", async () => {
    const h = harness((c) =>
      c.body.query.includes("launchStudioVersion")
        ? { json: { data: { launchStudioVersion: { id: "dep-9", status: "PENDING" } } } }
        : { json: {} },
    );
    const out = await cloudLaunch(h.ctx, input);

    expect(out).toEqual({ deploymentId: "dep-9", status: "PENDING" });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe(`${SWITCHBOARD}/graphql`);
    expect(h.calls[0].headers[STUDIO_SECRET_HEADER]).toBe(h.secret);
    expect(h.calls[0].headers.authorization).toBe(`Bearer ${h.bearer}`);
    expect(h.calls[0].body.variables).toEqual({ input });
    expect(h.calls[0].body.query).not.toContain("productDriveId");

    // A refused call: the cloud echoes the secret back; neither the log nor the error carries it.
    const refused = harness((c) => ({
      json: {
        errors: [
          {
            message: `This Studio can only launch its own product (${c.headers[STUDIO_SECRET_HEADER]})`,
            extensions: { code: "STUDIO_BINDING" },
          },
        ],
      },
    }));
    const err = await cloudLaunch(refused.ctx, input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LaunchError);
    expect((err as LaunchError).code).toBe("STUDIO_BINDING");
    expect(isPermissionError(err)).toBe(false);
    const everything = [...h.lines, ...refused.lines, (err as Error).message, (err as LaunchError).reason];
    expect(refused.lines.length).toBeGreaterThan(0);
    for (const line of everything) {
      expect(line).not.toContain(h.secret);
      expect(line).not.toContain(refused.secret);
      expect(line).not.toContain(h.bearer);
      expect(line).not.toContain(refused.bearer);
    }
  });

  it("maps an expired or missing delegation to a permission problem (F7)", async () => {
    for (const code of ["DELEGATION_EXPIRED", "DELEGATION_MISSING"]) {
      const h = harness(() => ({ json: { errors: [{ message: "x", extensions: { code } }] } }));
      const err = await cloudLaunch(h.ctx, input).catch((e: unknown) => e);
      expect(isPermissionError(err)).toBe(true);
      expect((err as LaunchError).code).toBe(code);
      expect((err as LaunchError).reason).toBe("your Studio needs your OK to publish");
    }
  });

  it("refuses to call without a launch secret or a signed-in agent", async () => {
    const noSecret = harness(() => ({ json: {} }));
    noSecret.ctx.env = {};
    await expect(cloudLaunch(noSecret.ctx, input)).rejects.toMatchObject({ code: "NO_LAUNCH_SECRET" });

    const signedOut = harness(() => ({ json: {} }));
    signedOut.ctx.bearerToken = async () => null;
    const err = await cloudLaunch(signedOut.ctx, input).catch((e: unknown) => e);
    expect(isPermissionError(err)).toBe(true);
    expect(noSecret.calls).toHaveLength(0);
    expect(signedOut.calls).toHaveLength(0);
  });

  it("reports an unreachable cloud as CLOUD_UNAVAILABLE", async () => {
    const h = harness(() => ({ status: 504, json: { message: "Gateway Timeout" } }));
    await expect(cloudLaunch(h.ctx, input)).rejects.toMatchObject({ code: "CLOUD_UNAVAILABLE" });
  });
});

describe("cloudRollback", () => {
  it("re-deploys a previous deployment", async () => {
    const h = harness(() => ({
      json: { data: { rollbackStudioVersion: { id: "dep-10", status: "PENDING" } } },
    }));
    expect(await cloudRollback(h.ctx, "dep-7")).toEqual({ deploymentId: "dep-10", status: "PENDING" });
    expect(h.calls[0].body.variables).toEqual({ deploymentId: "dep-7" });
    expect(h.calls[0].headers[STUDIO_SECRET_HEADER]).toBe(h.secret);
  });
});

describe("ensureProduct", () => {
  it("creates or returns the product's App for this Studio", async () => {
    const h = harness(() => ({
      json: {
        data: {
          ensureStudioProduct: {
            id: "app-1",
            slug: "team-todo",
            productionEnvironmentId: "env-prod",
            productionUrls: { connect: "https://team-todo-2.vetra.io" },
          },
        },
      },
    }));
    expect(await ensureProduct(h.ctx, "Team todo")).toEqual({
      appId: "app-1",
      productionEnvironmentId: "env-prod",
      slug: "team-todo-2",
      liveUrl: "https://team-todo-2.vetra.io",
    });
    expect(h.calls[0].body.variables).toEqual({
      input: { studioEnvironmentId: "studio-env-1", name: "Team todo" },
    });
  });

  it("falls back to the App slug while the environment has no address yet", async () => {
    const h = harness(() => ({
      json: {
        data: {
          ensureStudioProduct: {
            id: "app-1",
            slug: "team-todo",
            productionEnvironmentId: "env-prod",
            productionUrls: { connect: null },
          },
        },
      },
    }));
    const out = await ensureProduct(h.ctx, "Team todo");
    expect(out.slug).toBe("team-todo");
    expect(out.liveUrl).toBe("https://team-todo.vetra.io");
  });

  it("needs the Studio's environment id", async () => {
    const h = harness(() => ({ json: {} }));
    h.ctx.config = { cloudSwitchboardUrl: SWITCHBOARD };
    await expect(ensureProduct(h.ctx, "x")).rejects.toMatchObject({ code: "NO_STUDIO" });
  });
});
