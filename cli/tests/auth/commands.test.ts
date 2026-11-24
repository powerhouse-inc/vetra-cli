import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensurePseudonym } from "@powerhousedao/shared/clis/identity";

import { whoami } from "../../src/commands/auth/whoami.js";
import { setRequireAdminIdentity } from "../../src/auth/owner-rule.js";
import { studioPath } from "../../src/helpers/studio-paths.js";

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

/** The credential "Authorize agent" stores for the agent. */
function authorizeAgent(address: string, expiresInMs = 60_000) {
  const file = studioPath(workdir, "agentRenown");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      user: {
        address,
        credential: {
          expirationDate: new Date(Date.now() + expiresInMs).toISOString(),
        },
      },
    }),
  );
}

describe("whoami — the only cloud auth tool", () => {
  it("exposes the whoami id", () => {
    expect(whoami.id).toBe("whoami");
  });

  it("reports not authorized when signed out and points at the Authorize button, without the network", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("no network here");
    });
    const result = await whoami.execute({}, ctx());
    expect(result.text).toMatch(/Not authorized/);
    expect(result.text).toMatch(/Renown/);
    expect(result.text).toMatch(/Authorize agent/);
    expect(result.text).toMatch(/no Renown login and no pseudonym/);
  });

  it("reports the agent's delegation, and an expired one as none", async () => {
    authorizeAgent(OWNER);
    expect((await whoami.execute({}, ctx())).text).toMatch(
      `Authorized to act as the user via Renown (${OWNER})`,
    );
    authorizeAgent(OWNER, -60_000);
    expect((await whoami.execute({}, ctx())).text).toMatch(/Not authorized/);
  });

  it("applies the cloud Studio's owner rule", async () => {
    authorizeAgent(OWNER);
    setRequireAdminIdentity(true);
    vi.stubEnv("ADMINS", "0xbeef");
    expect((await whoami.execute({}, ctx())).text).toMatch(/Not authorized/);
    vi.stubEnv("ADMINS", OWNER.toLowerCase());
    expect((await whoami.execute({}, ctx())).text).toMatch(/Authorized/);
  });

  it("names the user's pseudonym when they have no login", async () => {
    const pseudonym = await ensurePseudonym({ dataDir: workdir });
    expect((await whoami.execute({}, ctx())).text).toMatch(
      `their pseudonym is ${pseudonym.label}`,
    );
  });
});
