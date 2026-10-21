import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

// A cloud Studio's agent may only hold the owner's delegation: a console login
// approved with any other wallet is logged straight back out.

const OWNER = "0x00000000000000000000000000000000000000aa";
const ATTACKER = "0x00000000000000000000000000000000000000bb";

let approver = OWNER;
const logout = jest.fn(async () => {
  fakeRenown.user = undefined;
});
const fakeRenown: { user?: { address: string }; logout: typeof logout } = { logout };

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
    fakeRenown.user = { address: approver };
    return { status: "ready", user: fakeRenown.user };
  }),
}));

const { startAuth, confirmAuth } = await import("../../src/auth/renown.js");

describe("confirmAuth — owner-only agent identity", () => {
  const saved = process.env.ADMINS;
  let n = 0;
  let workdir: string;
  beforeEach(() => {
    process.env.ADMINS = OWNER;
    fakeRenown.user = undefined;
    logout.mockClear();
    workdir = `/tmp/confirm-auth-owner-${n++}`;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ADMINS;
    else process.env.ADMINS = saved;
  });

  it("cloud: a login approved with a non-owner wallet is refused and logged out", async () => {
    approver = ATTACKER;
    await startAuth(workdir, "https://renown.example");
    const state = await confirmAuth(workdir, "https://renown.example", 0, { requireAdmin: true });
    expect(state).toEqual({ authenticated: false, error: "not-owner" });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(fakeRenown.user).toBeUndefined();
  });

  it("cloud: the owner's approval is kept", async () => {
    approver = OWNER;
    await startAuth(workdir, "https://renown.example");
    const state = await confirmAuth(workdir, "https://renown.example", 0, { requireAdmin: true });
    expect(state).toEqual({ authenticated: true, address: OWNER });
    expect(logout).not.toHaveBeenCalled();
  });

  it("cloud with ADMINS unset: fails closed", async () => {
    delete process.env.ADMINS;
    approver = OWNER;
    await startAuth(workdir, "https://renown.example");
    const state = await confirmAuth(workdir, "https://renown.example", 0, { requireAdmin: true });
    expect(state).toMatchObject({ authenticated: false, error: "not-owner" });
  });

  it("local: any wallet the user approves is kept", async () => {
    approver = ATTACKER;
    await startAuth(workdir, "https://renown.example");
    const state = await confirmAuth(workdir, "https://renown.example", 0);
    expect(state).toEqual({ authenticated: true, address: ATTACKER });
  });
});
