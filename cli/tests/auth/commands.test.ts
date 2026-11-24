import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCredentialRecord, type CredentialLike } from "@powerhousedao/shared/clis/credential-records";
import { ensurePseudonym, loginPaths } from "@powerhousedao/shared/clis/identity";
import { ensureSessionFile, writeSessionFile } from "@powerhousedao/shared/clis/sessions";

import { whoami } from "../../src/commands/auth/whoami.js";
import { setRequireAdminIdentity } from "../../src/auth/owner-rule.js";
import { agentSessionFile } from "../../src/auth/agent-files.js";

const OWNER = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

let root: string;
let workdir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vetra-whoami-"));
  workdir = join(root, "project");
  mkdirSync(workdir);
  vi.stubEnv("PH_IDENTITY_HOME", join(root, "identities"));
  vi.stubEnv("PH_USER_DATA_DIR", undefined);
  vi.stubEnv("PH_IDENTITY_KEY", undefined);
});
afterEach(() => {
  setRequireAdminIdentity(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

const ctx = () => ({ workdir, config: {} }) as never;

/** The credential a wallet approves the agent's session with ("Authorize agent"). */
function approveAgent(address: string, expiresInMs = 60_000) {
  const file = agentSessionFile(workdir);
  const session = ensureSessionFile(file, "vetra agent vetra-agent");
  const credential: CredentialLike = {
    id: "urn:uuid:agent",
    issuer: { id: `did:pkh:eip155:1:${address.toLowerCase()}`, ethereumAddress: address },
    credentialSubject: { id: session.did, app: "renown-app" },
    issuanceDate: new Date(Date.now() - 1000).toISOString(),
    expirationDate: new Date(Date.now() + expiresInMs).toISOString(),
    proof: { proofValue: "0x00" },
  };
  writeSessionFile(file, { ...session, credential });
  if (expiresInMs > 0) writeCredentialRecord({ dataDir: workdir, credential, source: "cli" });
}

function logIn(address = OWNER) {
  const paths = loginPaths();
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(
    paths.file,
    JSON.stringify({
      user: {
        address,
        chainId: 1,
        credential: { id: "urn:uuid:login", expirationDate: new Date(Date.now() + 60_000).toISOString() },
      },
    }),
  );
}

describe("whoami — the agent's session, from its files", () => {
  it("exposes the whoami id", () => {
    expect(whoami.id).toBe("whoami");
  });

  it("acts for the pseudonym with nobody logged in, made at its first write, without the network", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("no network here");
    });
    const result = await whoami.execute({}, ctx());
    expect(result.text).toMatch(/vetra agent vetra-agent/);
    expect(result.text).toMatch(/acts for the user's pseudonym, made at your first write/);
    expect(result.text).toMatch(/no Renown login and no pseudonym/);
  });

  it("names the user's pseudonym when they have no login", async () => {
    const pseudonym = await ensurePseudonym({ dataDir: workdir });
    const text = (await whoami.execute({}, ctx())).text;
    expect(text).toMatch(`acts for the user's pseudonym, ${pseudonym.label}`);
    expect(text).toMatch(`their pseudonym is ${pseudonym.label}`);
  });

  it("is not authorized for a Renown login until the wallet approves its session", async () => {
    logIn();
    expect((await whoami.execute({}, ctx())).text).toMatch(/Not authorized/);
    expect((await whoami.execute({}, ctx())).text).toMatch(/Authorize agent/);
    approveAgent(OWNER);
    const text = (await whoami.execute({}, ctx())).text;
    expect(text).toMatch(`authorized via Renown to act as ${OWNER}`);
    expect(text).toMatch(/this store holds its record/);
  });

  it("reads an expired approval as none", async () => {
    logIn();
    approveAgent(OWNER, -60_000);
    expect((await whoami.execute({}, ctx())).text).toMatch(/Not authorized/);
  });

  it("applies the cloud Studio's owner rule", async () => {
    approveAgent(OWNER);
    setRequireAdminIdentity(true);
    vi.stubEnv("ADMINS", "0xbeef");
    expect((await whoami.execute({}, ctx())).text).toMatch(/Not authorized/);
    vi.stubEnv("ADMINS", OWNER.toLowerCase());
    expect((await whoami.execute({}, ctx())).text).toMatch(/authorized via Renown/);
  });
});
