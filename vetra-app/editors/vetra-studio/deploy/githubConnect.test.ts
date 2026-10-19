import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  authorizeGithub,
  connectGithub,
  githubInstallUrl,
  myGithubConnection,
  myGithubStatus,
  startGithubDeviceFlow,
} from "./githubConnect.js";

// A provisioned studio: the agent wrote its switchboard into studio.config.json.
vi.mock("../hooks/preview-server-client.js", () => ({
  resolveStudioCloudSwitchboardUrl: vi.fn(
    async () => "https://switchboard.vetra.io",
  ),
}));

const CONNECTION = {
  environmentId: "env-1",
  repoFullName: "alice/widget",
  repoUrl: "https://github.com/alice/widget",
  createdAt: "2026-01-01T00:00:00Z",
};

function gqlResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("githubInstallUrl", () => {
  it("points at the app's install page", () => {
    expect(githubInstallUrl()).toBe(
      "https://github.com/apps/vetra-studio/installations/new",
    );
  });
});

describe("myGithubConnection", () => {
  it("returns the connection status", async () => {
    fetchSpy.mockResolvedValue(
      gqlResponse({
        data: {
          VetraGithubAuth: {
            myGithubConnection: { connected: true, connection: CONNECTION },
          },
        },
      }),
    );

    expect(await myGithubConnection("env-1", "tok")).toEqual({
      connected: true,
      connection: CONNECTION,
    });
  });

  it("returns null on a network failure", async () => {
    fetchSpy.mockRejectedValue(new Error("offline"));
    expect(await myGithubConnection("env-1", "tok")).toBeNull();
  });
});

describe("myGithubStatus", () => {
  it("returns the full status", async () => {
    fetchSpy.mockResolvedValue(
      gqlResponse({
        data: {
          VetraGithubAuth: {
            myGithubStatus: {
              connected: true,
              connection: CONNECTION,
              githubLogin: "alice",
              appInstalled: true,
              repoAccessible: false,
            },
          },
        },
      }),
    );

    expect(await myGithubStatus("env-1", "tok")).toEqual({
      connected: true,
      connection: CONNECTION,
      githubLogin: "alice",
      appInstalled: true,
      repoAccessible: false,
    });
  });

  it("returns null on a network failure", async () => {
    fetchSpy.mockRejectedValue(new Error("offline"));
    expect(await myGithubStatus("env-1", "tok")).toBeNull();
  });
});

describe("startGithubDeviceFlow", () => {
  it("returns the device flow", async () => {
    const flow = {
      deviceCode: "dev",
      userCode: "WXYZ-1234",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 5,
    };
    fetchSpy.mockResolvedValue(
      gqlResponse({
        data: { VetraGithubAuth: { startGithubDeviceFlow: flow } },
      }),
    );

    expect(await startGithubDeviceFlow("tok")).toEqual(flow);
  });
});

describe("authorizeGithub", () => {
  it("returns authorized with identity + install state", async () => {
    fetchSpy.mockResolvedValue(
      gqlResponse({
        data: {
          VetraGithubAuth: {
            authorizeGithub: { githubLogin: "alice", appInstalled: false },
          },
        },
      }),
    );

    expect(await authorizeGithub("dev", "tok")).toEqual({
      status: "authorized",
      githubLogin: "alice",
      appInstalled: false,
    });
  });

  it("maps AUTHORIZATION_PENDING to pending", async () => {
    fetchSpy.mockResolvedValue(
      gqlResponse({
        errors: [{ extensions: { code: "AUTHORIZATION_PENDING" } }],
      }),
    );

    expect(await authorizeGithub("dev", "tok")).toEqual({ status: "pending" });
  });

  it("surfaces unknown codes as an error result", async () => {
    fetchSpy.mockResolvedValue(
      gqlResponse({ errors: [{ extensions: { code: "BOOM" } }] }),
    );

    const result = await authorizeGithub("dev", "tok");
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain(
      "(BOOM). Try again",
    );
  });
});

describe("connectGithub", () => {
  it("returns connected with the connection on success", async () => {
    fetchSpy.mockResolvedValue(
      gqlResponse({
        data: {
          VetraGithubAuth: {
            connectGithub: { connected: true, connection: CONNECTION },
          },
        },
      }),
    );

    expect(await connectGithub("dev", "widget", "env-1", "tok")).toEqual({
      status: "connected",
      connection: CONNECTION,
    });
  });

  const CODE_CASES: Array<[string, string]> = [
    ["AUTHORIZATION_PENDING", "pending"],
    ["SLOW_DOWN", "slowDown"],
    ["DEVICE_CODE_EXPIRED", "expired"],
    ["ACCESS_DENIED", "denied"],
    ["REPO_ALREADY_EXISTS", "repoExists"],
    ["APP_NOT_INSTALLED", "appNotInstalled"],
    ["UNAUTHENTICATED", "unauthenticated"],
  ];

  it.each(CODE_CASES)("maps %s to %s", async (code, status) => {
    fetchSpy.mockResolvedValue(
      gqlResponse({ errors: [{ extensions: { code } }] }),
    );

    expect(await connectGithub("dev", "widget", "env-1", "tok")).toEqual({
      status,
    });
  });

  it("surfaces unknown codes as an error result", async () => {
    fetchSpy.mockResolvedValue(
      gqlResponse({ errors: [{ extensions: { code: "SOMETHING_ELSE" } }] }),
    );

    const result = await connectGithub("dev", "widget", "env-1", "tok");
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain(
      "(SOMETHING_ELSE). Try again",
    );
  });

  it("maps REPO_EXISTS like REPO_ALREADY_EXISTS", async () => {
    fetchSpy.mockResolvedValue(
      gqlResponse({ errors: [{ extensions: { code: "REPO_EXISTS" } }] }),
    );
    expect(await connectGithub("dev", "widget", "env-1", "tok")).toEqual({
      status: "repoExists",
    });
  });

  const MESSAGE_CASES: Array<[string, RegExp]> = [
    [
      "INSUFFICIENT_PERMISSION",
      /Install the Vetra GitHub app.*Administration permission/,
    ],
    ["GITHUB_NOT_CONNECTED", /Reconnect GitHub/],
    ["GITHUB_UNAVAILABLE", /GitHub is not responding\. Try again in a minute/],
    ["ORG_POLICY", /organisation.*Ask an owner/],
    ["DEPLOY_SETUP_FAILED", /rolled back.*try again/i],
    ["INTERNAL_SERVER_ERROR", /Try again/],
  ];

  it.each(MESSAGE_CASES)(
    "explains %s with a next step",
    async (code, message) => {
      fetchSpy.mockResolvedValue(
        gqlResponse({ errors: [{ message: code, extensions: { code } }] }),
      );
      const result = await connectGithub("dev", "widget", "env-1", "tok");
      expect(result.status).toBe("error");
      expect(result.status === "error" && result.message).toMatch(message);
    },
  );

  it("includes GitHub's reason for REPO_NAME_INVALID", async () => {
    fetchSpy.mockResolvedValue(
      gqlResponse({
        errors: [
          {
            message:
              "GitHub did not accept this repository name (name is invalid).",
            extensions: {
              code: "REPO_NAME_INVALID",
              reason: "name is invalid",
            },
          },
        ],
      }),
    );
    expect(await connectGithub("dev", "widget", "env-1", "tok")).toEqual({
      status: "error",
      message:
        "GitHub did not accept this repository name (name is invalid). Choose another name.",
    });
  });
});
