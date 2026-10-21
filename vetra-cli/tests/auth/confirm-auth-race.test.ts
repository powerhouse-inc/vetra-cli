import { describe, expect, it, jest } from "@jest/globals";

// Two studio hooks (Deploy view + agent panel) poll POST /auth/confirm at the
// same time. When one confirm lands the login it clears the pending session;
// the other, still awaiting its poll, must not then read `pending.loginUrl`
// off the cleared entry (staging: "Cannot read properties of undefined
// (reading 'loginUrl')").

const ADDRESS = "0xad0ae7afa30861ace288e5ca42c84c9aed705027";

const fakeRenown: { user?: { address: string }; baseUrl: string } = {
  baseUrl: "https://renown.example",
};

let releaseLoser: (() => void) | undefined;

jest.unstable_mockModule("@renown/sdk/node", () => ({
  RenownBuilder: class {
    build() {
      return Promise.resolve(fakeRenown);
    }
  },
  generateAccessToken: jest.fn(),
  getAuthStatus: jest.fn(),
}));

jest.unstable_mockModule("../../src/auth/login-flow.js", () => ({
  startLogin: () => ({ url: "https://renown.example/console?session=s1", sessionId: "s1" }),
  pollLogin: jest.fn(async () => {
    if (!releaseLoser) {
      // Loser: still waiting when the winner completes the login.
      await new Promise<void>((resolve) => {
        releaseLoser = resolve;
      });
      return { status: "pending" };
    }
    fakeRenown.user = { address: ADDRESS };
    return { status: "ready", user: fakeRenown.user };
  }),
}));

const { startAuth, confirmAuth } = await import("../../src/auth/renown.js");

describe("confirmAuth — concurrent confirms", () => {
  it("a confirm that loses the race reports the completed login instead of throwing", async () => {
    const workdir = "/tmp/confirm-auth-race";
    const url = "https://renown.example";
    const started = await startAuth(workdir, url);
    expect(started.pending?.loginUrl).toContain("session=s1");

    const loser = confirmAuth(workdir, url, 8000);
    await Promise.resolve();
    const winner = await confirmAuth(workdir, url, 8000);
    expect(winner).toEqual({ authenticated: true, address: ADDRESS });

    releaseLoser?.();
    await expect(loser).resolves.toEqual({ authenticated: true, address: ADDRESS });
  });
});
