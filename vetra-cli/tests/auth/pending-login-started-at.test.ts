import { describe, expect, it, jest } from "@jest/globals";

// The Studio reopens a pending Renown login whose tab was closed, and starts a
// fresh one once Renown has dropped the session: it needs to know when the
// pending login started and how old it is (by the daemon's clock).

const fakeRenown: { user?: { address: string }; baseUrl: string } = {
  baseUrl: "https://renown.example",
};

jest.unstable_mockModule("@renown/sdk/node", () => ({
  RenownBuilder: class {
    build() {
      return Promise.resolve(fakeRenown);
    }
  },
  generateAccessToken: jest.fn(),
  getAuthStatus: jest.fn(),
}));

let session = 0;
jest.unstable_mockModule("../../src/auth/login-flow.js", () => ({
  startLogin: () => {
    session += 1;
    return {
      url: `https://renown.example/console?session=s${session}`,
      sessionId: `s${session}`,
    };
  },
  pollLogin: jest.fn(async () => ({ status: "pending" })),
}));

const { startAuth, getAuthState, confirmAuth } = await import("../../src/auth/renown.js");

describe("pending Renown login", () => {
  it("reports when the pending login started and its age, on start, status and confirm", async () => {
    const workdir = "/tmp/pending-login-started-at";
    const url = "https://renown.example";
    const before = Date.now();
    const started = await startAuth(workdir, url);
    const after = Date.now();

    expect(started.pending?.loginUrl).toContain("session=s1");
    const startedAt = started.pending?.startedAt ?? 0;
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);

    expect(started.pending?.ageMs).toBe(0);

    // The age is the daemon's own measure, so a browser with a skewed clock
    // can compare it with the Renown lifetime.
    const now = jest.spyOn(Date, "now").mockReturnValue(startedAt + 90_000);
    try {
      expect(await getAuthState(workdir, url)).toEqual({
        authenticated: false,
        pending: { loginUrl: started.pending?.loginUrl, startedAt, ageMs: 90_000 },
      });
      expect(await confirmAuth(workdir, url, 0)).toEqual({
        authenticated: false,
        pending: { loginUrl: started.pending?.loginUrl, startedAt, ageMs: 90_000 },
      });
    } finally {
      now.mockRestore();
    }
  });
});
