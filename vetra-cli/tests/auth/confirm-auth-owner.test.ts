import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

// A cloud Studio's agent may only hold the owner's delegation: a console login
// approved with any other wallet is logged straight back out.

const OWNER = "0x00000000000000000000000000000000000000aa";
const ATTACKER = "0x00000000000000000000000000000000000000bb";

let approver = OWNER;
const logout = jest.fn(async () => {
  fakeRenown.user = undefined;
});
const fakeRenown: {
  user?: { address: string };
  logout: typeof logout;
  getBearerToken: () => Promise<string>;
  signer: object;
} = { logout, getBearerToken: async () => "agent-token", signer: {} };

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

const { startAuth, confirmAuth, getAuthState, getBearerToken, setRequireAdminIdentity } =
  await import("../../src/auth/renown.js");

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

  describe("a credential stored before the rule (cloud)", () => {
    const savedEnv = process.env.VETRA_ENVIRONMENT_ID;
    afterEach(() => {
      setRequireAdminIdentity(undefined);
      if (savedEnv === undefined) delete process.env.VETRA_ENVIRONMENT_ID;
      else process.env.VETRA_ENVIRONMENT_ID = savedEnv;
    });

    it("a non-owner stored identity reads as signed out and is cleared", async () => {
      process.env.VETRA_ENVIRONMENT_ID = "env-1";
      fakeRenown.user = { address: ATTACKER };
      expect(await getAuthState(workdir, "https://renown.example")).toEqual({
        authenticated: false,
      });
      expect(logout).toHaveBeenCalledTimes(1);
      fakeRenown.user = { address: ATTACKER };
      expect(await getBearerToken(workdir, "https://renown.example")).toBeNull();
    });

    it("the owner's stored identity is kept", async () => {
      setRequireAdminIdentity(true);
      fakeRenown.user = { address: OWNER };
      expect(await getAuthState(workdir, "https://renown.example")).toEqual({
        authenticated: true,
        address: OWNER,
      });
      expect(await getBearerToken(workdir, "https://renown.example")).toBe("agent-token");
      expect(logout).not.toHaveBeenCalled();
    });

    it("local: a stored identity is left alone", async () => {
      delete process.env.VETRA_ENVIRONMENT_ID;
      fakeRenown.user = { address: ATTACKER };
      expect(await getAuthState(workdir, "https://renown.example")).toMatchObject({
        authenticated: true,
      });
    });
  });
});
