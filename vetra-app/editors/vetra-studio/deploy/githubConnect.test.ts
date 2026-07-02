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
  connectGithub,
  githubInstallUrl,
  myGithubConnection,
  startGithubDeviceFlow,
} from "./githubConnect.js";

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

    expect(await connectGithub("dev", "widget", "env-1", "tok")).toEqual({
      status: "error",
      message: "SOMETHING_ELSE",
    });
  });
});
