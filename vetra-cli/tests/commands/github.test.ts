import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { makeCtx, makeWorkdir } from "../spec/_fixtures.js";

const ENV_ID = "env-1";
const SLUG = "vetra-studio";
const REPO = "alice/widget";

const getBearerToken = jest.fn<
  (workdir: string, renownUrl: string) => Promise<string | null>
>(async () => "user_bearer");

jest.unstable_mockModule("../../src/auth/renown.js", () => ({ getBearerToken }));
jest.unstable_mockModule("../../src/cloud/config.js", () => ({
  resolveCloudConfig: () => ({
    switchboardUrl: "http://localhost:5555",
    renownUrl: "http://localhost:5555/renown",
    graphqlEndpoint: "http://localhost:5555/graphql",
  }),
}));

const { githubPush } = await import("../../src/commands/github/push.js");
const { githubPull } = await import("../../src/commands/github/pull.js");
const { githubClone } = await import("../../src/commands/github/clone.js");

type RunProcessFn = (
  command: string,
  opts?: unknown,
) => Promise<{ success: boolean; output: string }>;

function fakeRun(result: { success: boolean; output: string }) {
  return jest.fn<RunProcessFn>(async () => result);
}

function ctx(workdir: string, runProcess: unknown) {
  return {
    ...makeCtx(workdir),
    config: {
      environmentId: ENV_ID,
      githubAppSlug: SLUG,
      cloudSwitchboardUrl: "http://localhost:5555",
      cloudRenownUrl: "http://localhost:5555/renown",
    },
    runProcess,
  } as unknown as Parameters<typeof githubPush.execute>[1];
}

/**
 * Route fetch by URL/operation: the GitHub bot-user lookup, and the two cloud
 * switchboard ops (myGithubConnection, getPushToken) that `resolveRepoRemote`
 * makes.
 */
function mockGithub(
  fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>,
  opts: { connected?: boolean; repoFullName?: string } = {},
) {
  const connected = opts.connected ?? true;
  const repoFullName = opts.repoFullName ?? REPO;
  const json = (body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  fetchSpy.mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes("api.github.com/users/")) {
      return json({ id: 999 });
    }
    const query = String(
      (JSON.parse(String((init as RequestInit)?.body ?? "{}")) as { query?: string }).query ?? "",
    );
    if (query.includes("myGithubConnection")) {
      return json({
        data: {
          VetraGithubAuth: {
            myGithubConnection: {
              connected,
              connection: connected
                ? {
                    environmentId: ENV_ID,
                    installationId: "123",
                    repoFullName,
                    repoUrl: `https://github.com/${repoFullName}`,
                    createdAt: "2026-01-01",
                  }
                : null,
            },
          },
        },
      });
    }
    if (query.includes("getPushToken")) {
      return json({
        data: { VetraGithubAuth: { getPushToken: { token: "ghs_token", expiresAt: "x" } } },
      });
    }
    return json({});
  });
}

describe("github command shapes", () => {
  it("exposes ids and inputs", () => {
    expect(githubPush.id).toBe("github-push");
    expect(githubPush.inputSchema.shape).toHaveProperty("branch");
    expect(githubPush.inputSchema.shape).toHaveProperty("message");
    expect(githubPull.id).toBe("github-pull");
    expect(githubPull.inputSchema.shape).toHaveProperty("branch");
    expect(githubClone.id).toBe("github-clone");
  });
});

describe("github commands", () => {
  let workdir: string;
  let cleanup: () => void;
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  beforeEach(() => {
    ({ workdir, cleanup } = makeWorkdir());
    fetchSpy = jest.spyOn(globalThis, "fetch");
    getBearerToken.mockReset();
    getBearerToken.mockImplementation(async () => "user_bearer");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    cleanup();
  });

  it("github-push commits as the bot and pushes with the token", async () => {
    mockGithub(fetchSpy);
    const runProcess = fakeRun({ success: true, output: "" });
    const result = await githubPush.execute(
      { branch: "main", message: "Update" },
      ctx(workdir, runProcess),
    );
    expect(result.text).toMatch(/Pushed alice\/widget/);
    const commands = runProcess.mock.calls.map((c) => String(c[0]));
    expect(commands.some((c) => c.startsWith("git init"))).toBe(true);
    expect(commands.some((c) => c.includes("user.name='vetra-studio[bot]'"))).toBe(true);
    expect(
      commands.some(
        (c) => c.includes("git push") && c.includes("ghs_token") && c.includes("alice/widget"),
      ),
    ).toBe(true);
  });

  it("github-pull fast-forwards from the repo", async () => {
    mockGithub(fetchSpy);
    const runProcess = fakeRun({ success: true, output: "" });
    const result = await githubPull.execute({ branch: "main" }, ctx(workdir, runProcess));
    expect(result.text).toMatch(/Pulled alice\/widget/);
    const commands = runProcess.mock.calls.map((c) => String(c[0]));
    expect(
      commands.some((c) => c.includes("git pull --ff-only") && c.includes("ghs_token")),
    ).toBe(true);
  });

  it("github-clone clones then strips the token from origin", async () => {
    mockGithub(fetchSpy);
    const runProcess = fakeRun({ success: true, output: "" });
    const result = await githubClone.execute({}, ctx(workdir, runProcess));
    expect(result.text).toMatch(/Cloned alice\/widget/);
    const commands = runProcess.mock.calls.map((c) => String(c[0]));
    expect(commands.some((c) => c.startsWith("git clone") && c.includes("ghs_token"))).toBe(true);
    expect(
      commands.some(
        (c) =>
          c.includes("git remote set-url origin") &&
          c.includes("https://github.com/alice/widget.git") &&
          !c.includes("ghs_token"),
      ),
    ).toBe(true);
  });

  it("errors when the agent is not authorized for the user", async () => {
    getBearerToken.mockResolvedValueOnce(null);
    const runProcess = fakeRun({ success: true, output: "" });
    await expect(
      githubPush.execute({ branch: "main", message: "x" }, ctx(workdir, runProcess)),
    ).rejects.toThrow(/not authorized/i);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("errors when the environment is not connected", async () => {
    mockGithub(fetchSpy, { connected: false });
    const runProcess = fakeRun({ success: true, output: "" });
    await expect(
      githubPush.execute({ branch: "main", message: "x" }, ctx(workdir, runProcess)),
    ).rejects.toThrow(/not connected/i);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("scrubs the token from a git failure message", async () => {
    mockGithub(fetchSpy);
    const runProcess = fakeRun({
      success: false,
      output: "fatal: auth failed at https://x-access-token:ghs_token@github.com/alice/widget.git",
    });
    const err = await githubPush
      .execute({ branch: "main", message: "x" }, ctx(workdir, runProcess))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(String(err)).toContain("***");
    expect(String(err)).not.toContain("ghs_token");
  });
});
