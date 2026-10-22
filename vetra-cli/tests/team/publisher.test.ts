import { afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Task 1.11: an org Studio publishes as the organisation's publisher (the
// cloud delegates it to this Studio's agent key); a personal Studio publishes
// as its owner.

const { PUBLISHER_FILE, PUBLISHER_REFRESH_MS, publishIdentity, registryTokenFor } = await import(
  "../../src/team/publisher.js"
);

const ORG_PUBLISHER = "0x4444444444444444444444444444444444444444";
const DAY = 24 * 60 * 60 * 1000;

const dirs: string[] = [];
function freshWorkdir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-publisher-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function ctxFor(workdir: string, config: Record<string, string | undefined> = {}) {
  return {
    workdir,
    config: { cloudSwitchboardUrl: "https://cloud.example/graphql", ...config },
    now: () => Date.parse("2026-10-22T10:00:00.000Z"),
  };
}

function fakeDeps(expiresAt = new Date(Date.parse("2026-10-22T10:00:00.000Z") + 30 * DAY).toISOString()) {
  const fetchCredential = jest.fn(async () => ({
    address: ORG_PUBLISHER,
    credential: JSON.stringify({ proof: "opaque" }),
    expiresAt,
  }));
  const registryToken = jest.fn(async (_ctx: unknown, address: string | null, registry: string) =>
    address ? `publisher-token-for-${address}@${registry}` : "owner-token",
  );
  return { fetchCredential, registryToken };
}

describe("publish identity", () => {
  it("an org Studio publishes as the organisation's publisher", async () => {
    const workdir = freshWorkdir();
    const deps = fakeDeps();
    const ctx = ctxFor(workdir, { studioOrgId: "org-1", environmentId: "env-1" });

    expect(await publishIdentity(ctx, deps)).toEqual({ kind: "org", address: ORG_PUBLISHER });
    expect(deps.fetchCredential).toHaveBeenCalledTimes(1);
    expect(deps.fetchCredential).toHaveBeenCalledWith(ctx, "env-1");

    // Cached: the next call costs no cloud request.
    expect(await publishIdentity(ctx, deps)).toEqual({ kind: "org", address: ORG_PUBLISHER });
    expect(deps.fetchCredential).toHaveBeenCalledTimes(1);

    const cached = JSON.parse(fs.readFileSync(path.join(workdir, PUBLISHER_FILE), "utf-8")) as {
      address: string;
      credential: string;
      expiresAt: string;
    };
    expect(cached).toMatchObject({ address: ORG_PUBLISHER });
    expect(fs.statSync(path.join(workdir, PUBLISHER_FILE)).mode & 0o777).toBe(0o600);

    // The registry token is minted as the publisher, never as a person.
    expect(
      await registryTokenFor(
        { ...ctx, config: { ...ctx.config, studioOrgId: "org-1" } },
        { kind: "org", address: ORG_PUBLISHER },
        "https://registry.example",
        deps,
      ),
    ).toBe(`publisher-token-for-${ORG_PUBLISHER}@https://registry.example`);
    expect(deps.registryToken).toHaveBeenCalledWith(
      expect.anything(),
      ORG_PUBLISHER,
      "https://registry.example",
    );
  });

  it("a delegation that is close to expiring is replaced", async () => {
    const workdir = freshWorkdir();
    const ctx = ctxFor(workdir, { studioOrgId: "org-1", environmentId: "env-1" });
    fs.mkdirSync(path.dirname(path.join(workdir, PUBLISHER_FILE)), { recursive: true });
    fs.writeFileSync(
      path.join(workdir, PUBLISHER_FILE),
      JSON.stringify({
        version: 1,
        address: ORG_PUBLISHER,
        credential: "{}",
        expiresAt: new Date(Date.parse("2026-10-22T10:00:00.000Z") + PUBLISHER_REFRESH_MS - 1).toISOString(),
      }),
    );
    const deps = fakeDeps();
    expect(await publishIdentity(ctx, deps)).toEqual({ kind: "org", address: ORG_PUBLISHER });
    expect(deps.fetchCredential).toHaveBeenCalledTimes(1);
  });

  it("a personal Studio publishes as its owner", async () => {
    const workdir = freshWorkdir();
    const deps = fakeDeps();
    const ctx = ctxFor(workdir, { environmentId: "env-1" });

    expect(await publishIdentity(ctx, deps)).toEqual({ kind: "owner" });
    expect(deps.fetchCredential).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(workdir, PUBLISHER_FILE))).toBe(false);

    // The owner path goes through the agent's own Renown identity (not signed
    // in here, so no token) — never through the publisher seam.
    expect(
      await registryTokenFor(ctx, { kind: "owner" }, "https://registry.example", deps),
    ).toBeNull();
    expect(deps.registryToken).not.toHaveBeenCalled();
  });

  it("an org Studio without an environment id refuses instead of publishing as a person", async () => {
    const workdir = freshWorkdir();
    const deps = fakeDeps();
    await expect(
      publishIdentity(ctxFor(workdir, { studioOrgId: "org-1" }), deps),
    ).rejects.toMatchObject({ code: "PUBLISH_FAILED" });
    expect(deps.fetchCredential).not.toHaveBeenCalled();
  });
});
