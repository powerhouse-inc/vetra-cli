/**
 * The Studio agent's session (`auth/renown.ts`): the pseudonym's, issued at
 * its first write with no click; a Renown wallet's, approved once at
 * Renown's console ("Authorize agent"); withdrawn at once by "Withdraw". The
 * console itself is renown's (`pollSessionApproval`): here it is replaced by
 * a wallet that approves, keeping what renown keeps.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listCredentialRecords,
  writeCredentialRecord,
  type CredentialLike,
} from "@powerhousedao/shared/clis/credential-records";
import { ensurePseudonym, loginPaths } from "@powerhousedao/shared/clis/identity";
import { newSession, readSessionFile, writeSessionFile } from "@powerhousedao/shared/clis/sessions";
import { verifyAuthBearerToken } from "@renown/sdk/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "0x00000000000000000000000000000000000000aa";
const ATTACKER = "0x00000000000000000000000000000000000000bb";
const RENOWN = "https://renown.example";

/** What the wallet answering the console approves with. */
let approver = OWNER;
/** Set to hold a poll until released (the race of two confirms). */
let hold: Promise<void> | undefined;
/** Called once the held poll has started. */
let held: (() => void) | undefined;

function walletCredential(address: string, sessionDid: string): CredentialLike {
  const now = Date.now();
  return {
    id: `urn:uuid:${Math.random().toString(16).slice(2)}`,
    issuer: { id: `did:pkh:eip155:1:${address.toLowerCase()}`, ethereumAddress: address },
    credentialSubject: { id: sessionDid, app: "renown-app" },
    issuanceDate: new Date(now).toISOString(),
    expirationDate: new Date(now + 30 * 86_400_000).toISOString(),
    proof: { proofValue: "0x00" },
  };
}

vi.doMock("@renown/sdk/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@renown/sdk/identity")>();
  return {
    ...actual,
    // The person approves with `approver`'s wallet: kept as renown keeps it.
    pollSessionApproval: vi.fn(
      async (o: Parameters<typeof actual.pollSessionApproval>[0]) => {
        if (hold) {
          const waiting = hold;
          hold = undefined;
          held?.();
          await waiting;
          return { status: "pending" as const };
        }
        if (o.accept && !o.accept(approver)) return { status: "refused" as const, address: approver };
        const session = readSessionFile(o.approval.file)!;
        const credential = walletCredential(approver, session.did);
        writeSessionFile(o.approval.file, { ...session, credential });
        if (o.target?.dataDir) {
          writeCredentialRecord({ dataDir: o.target.dataDir, credential, source: "cli" });
        }
        return { status: "ready" as const, address: approver, credential: credential as never };
      },
    ),
  };
});

const agent = await import("../../src/auth/renown.js");
const { readAgentStatus, AGENT_LABEL } = await import("../../src/auth/agent-files.js");

let root: string;
let workdir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vetra-agent-"));
  workdir = join(root, "project");
  mkdirSync(workdir);
  vi.stubEnv("PH_IDENTITY_HOME", join(root, "identities"));
  vi.stubEnv("PH_USER_DATA_DIR", undefined);
  vi.stubEnv("PH_IDENTITY_KEY", undefined);
  vi.stubEnv("PH_IDENTITY_PASSWORD", undefined);
  vi.stubEnv("ADMINS", OWNER);
  vi.stubEnv("VETRA_ENVIRONMENT_ID", undefined);
  approver = OWNER;
});
afterEach(() => {
  agent.setRequireAdminIdentity(undefined);
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

/** A Renown login as `ph login` leaves it in the home folder. */
function logIn(address = OWNER) {
  const paths = loginPaths();
  mkdirSync(paths.dir, { recursive: true });
  const session = newSession("unused");
  writeFileSync(paths.keypair, JSON.stringify(session.key));
  writeFileSync(
    paths.file,
    JSON.stringify({
      user: {
        address,
        chainId: 1,
        credential: { id: "urn:uuid:login", expirationDate: new Date(Date.now() + 86_400_000).toISOString() },
      },
    }),
  );
}

describe("the agent of a local Studio, nobody logged in", () => {
  it("acts as the pseudonym, its credential issued at the first write with no click", async () => {
    expect(await agent.getAuthState(workdir)).toEqual({ authenticated: true, kind: "pseudonym" });
    expect(await agent.getAgentBearer(workdir)).toBeUndefined();

    const session = await agent.openAgentSession(workdir);
    expect(session.signer.app).toEqual({ name: AGENT_LABEL, key: session.credential.credentialSubject.id });
    const state = await agent.getAuthState(workdir);
    expect(state).toMatchObject({ authenticated: true, kind: "pseudonym", address: session.signer.user.address });
    expect(state.who).toMatch(/^Anonymous 0x/);
    expect(listCredentialRecords({ dataDir: workdir })).toMatchObject([{ label: AGENT_LABEL, source: "cli" }]);

    const bearer = await agent.getAgentBearer(workdir);
    const verified = bearer && (await verifyAuthBearerToken(bearer));
    expect(verified && verified.issuer).toBe(session.signer.app.key);
    // Renown knows no pseudonym: cloud services get no bearer.
    expect(await agent.getBearerToken(workdir, RENOWN)).toBeNull();
    expect(await agent.getRegistryToken(workdir, RENOWN, "https://registry.example")).toBeNull();
  });

  it("stops at once when withdrawn, and acts again only when authorized again", async () => {
    await agent.openAgentSession(workdir);
    const changes = vi.fn();
    const off = agent.onAgentChange(workdir, changes);
    expect(await agent.logoutAuth(workdir)).toMatchObject({ authenticated: false, withdrawn: true });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(listCredentialRecords({ dataDir: workdir })).toEqual([]);
    await expect(agent.openAgentSession(workdir)).rejects.toThrow(agent.AgentNotAuthorizedError);
    expect(await agent.getAgentBearer(workdir)).toBeUndefined();

    // A credential issued after the withdrawal lifts it: a later millisecond.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await agent.startAuth(workdir, RENOWN)).toMatchObject({ authenticated: true, kind: "pseudonym" });
    expect(changes).toHaveBeenCalledTimes(2);
    expect(listCredentialRecords({ dataDir: workdir })).toHaveLength(1);
    off();
  });
});

describe("the agent of a pseudonym locked with a password", () => {
  it("says it cannot sign, the Studio having no terminal to ask on, until the password is given", async () => {
    await ensurePseudonym({
      dataDir: workdir,
      password: "secret",
      kdf: { n: 1024, r: 8, p: 1, dklen: 32 },
    });
    expect(await agent.getAuthState(workdir)).toMatchObject({
      authenticated: false,
      kind: "pseudonym",
      locked: true,
    });
    expect(await agent.startAuth(workdir, RENOWN)).toMatchObject({ error: "locked" });
    await expect(agent.openAgentSession(workdir)).rejects.toThrow(agent.AgentLockedError);

    vi.stubEnv("PH_IDENTITY_PASSWORD", "secret");
    expect(await agent.getAuthState(workdir)).toMatchObject({ authenticated: true, kind: "pseudonym" });
    const session = await agent.openAgentSession(workdir);
    expect(session.signer.app.name).toBe(AGENT_LABEL);
  });
});

describe("the agent of a Renown user", () => {
  it("needs the console approval, then signs as the wallet that gave it", async () => {
    logIn();
    expect(await agent.getAuthState(workdir)).toMatchObject({ authenticated: false, kind: "renown" });
    await expect(agent.openAgentSession(workdir)).rejects.toThrow(agent.AgentNotAuthorizedError);

    const started = await agent.startAuth(workdir, RENOWN);
    const page = new URL(started.pending!.loginUrl);
    expect(page.origin + page.pathname).toBe(`${RENOWN}/console`);
    expect(page.searchParams.get("app")).toBe(AGENT_LABEL);
    expect(page.searchParams.get("connect")).toMatch(/^did:key:/);

    const confirmed = await agent.confirmAuth(workdir, RENOWN, 0);
    expect(confirmed).toMatchObject({ authenticated: true, kind: "renown", address: OWNER });
    expect(confirmed.pending).toBeUndefined();
    const session = await agent.openAgentSession(workdir);
    expect(session.signer.user.address).toBe(OWNER);
    expect(session.signer.app).toEqual({ name: "renown-app", key: page.searchParams.get("connect") });
    expect(await agent.getBearerToken(workdir, RENOWN)).toEqual(expect.any(String));
    const registry = await agent.getRegistryToken(workdir, RENOWN, "https://registry.example");
    const verified = registry && (await verifyAuthBearerToken(registry, { audience: "https://registry.example" }));
    expect(verified && verified.payload.aud).toBe("https://registry.example");

    // Withdraw forgets the approval: a new one is needed.
    expect(await agent.logoutAuth(workdir)).toMatchObject({ authenticated: false, kind: "renown" });
    expect(readSessionFile(join(workdir, ".ph", "sessions", "vetra-agent-vetra-agent.json"))?.credential).toBeUndefined();
  });

  it("reports when the pending approval started and its age, by the daemon's clock", async () => {
    logIn();
    const before = Date.now();
    const started = await agent.startAuth(workdir, RENOWN);
    const startedAt = started.pending!.startedAt;
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(started.pending?.ageMs).toBe(0);
    const now = vi.spyOn(Date, "now").mockReturnValue(startedAt + 90_000);
    try {
      expect((await agent.getAuthState(workdir)).pending).toEqual({
        loginUrl: started.pending!.loginUrl,
        startedAt,
        ageMs: 90_000,
      });
    } finally {
      now.mockRestore();
    }
  });

  it("a confirm that loses the race reports the completed approval", async () => {
    logIn();
    await agent.startAuth(workdir, RENOWN);
    let release!: () => void;
    hold = new Promise((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (held = resolve));
    const loser = agent.confirmAuth(workdir, RENOWN, 8000);
    await started;
    const winner = await agent.confirmAuth(workdir, RENOWN, 8000);
    expect(winner).toMatchObject({ authenticated: true, address: OWNER });
    release();
    await expect(loser).resolves.toMatchObject({ authenticated: true, address: OWNER });
  });
});

describe("a cloud Studio's agent: the owner's approval only", () => {
  beforeEach(() => agent.setRequireAdminIdentity(true));

  it("never acts as a pseudonym", async () => {
    expect(await agent.getAuthState(workdir)).toMatchObject({ authenticated: false, kind: "renown" });
    await expect(agent.openAgentSession(workdir)).rejects.toThrow(agent.AgentNotAuthorizedError);
    expect(readAgentStatus(workdir).needsApproval).toBe(true);
  });

  it("refuses a non-owner wallet's approval and keeps nothing of it", async () => {
    approver = ATTACKER;
    await agent.startAuth(workdir, RENOWN);
    expect(await agent.confirmAuth(workdir, RENOWN, 0, { requireAdmin: true })).toEqual({
      authenticated: false,
      error: "not-owner",
    });
    expect(listCredentialRecords({ dataDir: workdir })).toEqual([]);
  });

  it("keeps the owner's approval; with ADMINS unset, fails closed", async () => {
    await agent.startAuth(workdir, RENOWN);
    expect(await agent.confirmAuth(workdir, RENOWN, 0, { requireAdmin: true })).toMatchObject({
      authenticated: true,
      address: OWNER,
    });
    vi.stubEnv("ADMINS", "");
    expect(await agent.getAuthState(workdir)).toMatchObject({ authenticated: false });
  });

  it("drops an approval stored for a wallet that is not the owner", async () => {
    // Approved in a local Studio first, by a logged-in Renown user.
    agent.setRequireAdminIdentity(false);
    logIn(ATTACKER);
    approver = ATTACKER;
    await agent.startAuth(workdir, RENOWN);
    await agent.confirmAuth(workdir, RENOWN, 0);
    expect(await agent.getAuthState(workdir)).toMatchObject({ authenticated: true, address: ATTACKER });

    agent.setRequireAdminIdentity(true);
    expect(await agent.getAuthState(workdir)).toMatchObject({ authenticated: false });
    expect(readSessionFile(join(workdir, ".ph", "sessions", "vetra-agent-vetra-agent.json"))?.credential).toBeUndefined();
    expect(await agent.getBearerToken(workdir, RENOWN)).toBeNull();
  });
});
