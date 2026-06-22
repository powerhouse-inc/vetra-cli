import { describe, expect, it } from "@jest/globals";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { whoami } from "../../src/commands/auth/whoami.js";

// A throwaway workdir builds its own (unauthenticated) Renown identity under
// <workdir>/.ph — keypair generation is local. No network, no browser.
function freshCtx() {
  const workdir = mkdtempSync(join(tmpdir(), "vetra-cloud-test-"));
  return { workdir, config: {} } as never;
}

describe("whoami — the only cloud auth tool", () => {
  it("exposes the whoami id", () => {
    expect(whoami.id).toBe("whoami");
  });

  it("reports not authorized when signed out and points at the Authorize button", async () => {
    const result = await whoami.execute({}, freshCtx());
    expect(result.text).toMatch(/Not authorized/);
    expect(result.text).toMatch(/Renown/);
    expect(result.text).toMatch(/Authorize agent/);
  });
});
