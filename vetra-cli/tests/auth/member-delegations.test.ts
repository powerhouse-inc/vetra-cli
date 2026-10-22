import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// P6-4 / task 1.11: one delegation per member, all to the same agent key.
// A member's console login is stored under their own address (self only), so
// two members can allow the agent without replacing each other, and an org
// Studio with ADMINS="" still signs members in.

const MAKER = "0x00000000000000000000000000000000000000aa";
const OWNER = "0x00000000000000000000000000000000000000bb";
const STRANGER = "0x00000000000000000000000000000000000000cc";

interface FakeRenown {
  user?: { address: string };
  logout: () => Promise<void>;
  signer: { user?: { address: string } };
  getBearerToken: () => Promise<string>;
}

const builds: Array<{ keyPath?: string; storagePath?: string; renown: FakeRenown }> = [];
let approver = MAKER;

jest.unstable_mockModule("@renown/sdk/node", () => ({
  RenownBuilder: class {
    readonly options: { keyPath?: string; storagePath?: string };
    constructor(_app: string, options: { keyPath?: string; storagePath?: string }) {
      this.options = options;
    }
    build() {
      const renown: FakeRenown = {
        user: undefined,
        logout: async () => {
          renown.user = undefined;
          renown.signer.user = undefined;
        },
        signer: {},
        getBearerToken: async () => "agent-token",
      };
      builds.push({ ...this.options, renown });
      return Promise.resolve(renown);
    }
  },
  generateAccessToken: jest.fn(),
  getAuthStatus: jest.fn(),
}));

jest.unstable_mockModule("../../src/auth/login-flow.js", () => ({
  startLogin: () => ({ url: "https://renown.example/console?session=s1", sessionId: "s1" }),
  pollLogin: jest.fn(async () => {
    const user = { address: approver };
    // The fake Renown the login was started on is the last one built; the real
    // SDK sets the same `user` on the instance the session belongs to.
    const entry = builds[builds.length - 1];
    entry.renown.user = user;
    entry.renown.signer.user = user;
    return { status: "ready", user };
  }),
}));

const { confirmAuth, getMemberRenown, startAuth } = await import("../../src/auth/renown.js");
const { dropDelegation, getMemberSigner, hasDelegation } = await import(
  "../../src/team/delegations.js"
);

describe("per-member delegations", () => {
  const dirs: string[] = [];
  const savedAdmins = process.env.ADMINS;
  const savedEnv = process.env.VETRA_ENVIRONMENT_ID;

  function freshWorkdir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-member-delegations-"));
    dirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    builds.length = 0;
  });

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    if (savedAdmins === undefined) delete process.env.ADMINS;
    else process.env.ADMINS = savedAdmins;
    if (savedEnv === undefined) delete process.env.VETRA_ENVIRONMENT_ID;
    else process.env.VETRA_ENVIRONMENT_ID = savedEnv;
  });

  it("two members' delegations coexist on one key", async () => {
    const dir = freshWorkdir();
    const url = "https://renown.example";

    approver = MAKER;
    await startAuth(dir, url, { member: MAKER });
    expect(await confirmAuth(dir, url, 0, { member: MAKER })).toEqual({
      authenticated: true,
      address: MAKER,
    });

    approver = OWNER;
    await startAuth(dir, url, { member: OWNER });
    expect(await confirmAuth(dir, url, 0, { member: OWNER })).toEqual({
      authenticated: true,
      address: OWNER,
    });

    // Same agent key for both; a storage file each.
    const options = builds.map((b) => ({ keyPath: b.keyPath, storagePath: b.storagePath }));
    expect(new Set(options.map((o) => o.keyPath)).size).toBe(1);
    expect(options.map((o) => path.basename(o.storagePath!)).sort()).toEqual([
      `${MAKER}.json`,
      `${OWNER}.json`,
    ]);
    expect(options.map((o) => o.storagePath)).toContain(
      path.join(dir, ".ph", "vetra", "team", "delegations", `${MAKER}.json`),
    );

    // Each member signs as themselves, and an address that never allowed the
    // agent has no signer.
    expect((await getMemberSigner(dir, url, MAKER))?.user?.address).toBe(MAKER);
    expect((await getMemberSigner(dir, url, OWNER))?.user?.address).toBe(OWNER);
    expect(await getMemberSigner(dir, url, STRANGER)).toBeNull();
  });

  it("an org Studio with ADMINS unset keeps an admitted member's delegation", async () => {
    const dir = freshWorkdir();
    const url = "https://renown.example";
    process.env.VETRA_ENVIRONMENT_ID = "env-1";
    delete process.env.ADMINS;

    approver = MAKER;
    await startAuth(dir, url, { member: MAKER });
    expect(await confirmAuth(dir, url, 0, { member: MAKER })).toEqual({
      authenticated: true,
      address: MAKER,
    });

    const renown = await getMemberRenown(dir, url, MAKER);
    expect(renown.user?.address).toBe(MAKER);
  });

  it("a member's login approved with another wallet is refused", async () => {
    const dir = freshWorkdir();
    const url = "https://renown.example";
    approver = STRANGER;
    await startAuth(dir, url, { member: MAKER });
    expect(await confirmAuth(dir, url, 0, { member: MAKER })).toEqual({
      authenticated: false,
      error: "not-you",
    });
    expect(await getMemberSigner(dir, url, MAKER)).toBeNull();
  });

  it("dropping a delegation forgets the file and the identity", async () => {
    const dir = freshWorkdir();
    const url = "https://renown.example";
    approver = MAKER;
    const file = path.join(dir, ".ph", "vetra", "team", "delegations", `${MAKER}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ user: { address: MAKER } }));

    expect(hasDelegation(dir, MAKER)).toBe(true);

    dropDelegation(dir, MAKER);
    expect(hasDelegation(dir, MAKER)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(await getMemberSigner(dir, url, MAKER)).toBeNull();
  });
});
