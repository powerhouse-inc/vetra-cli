/**
 * Who the Cli writes as on the Studio switchboard: its agent's session, in
 * every Studio, opened at the agent's first write.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenSession } from "@renown/sdk/identity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { studioIdentity } from "../../src/auth/studio-identity.js";

let root: string;
let workdir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vetra-studio-identity-"));
  workdir = join(root, "project");
  mkdirSync(workdir);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fakeAgent() {
  const listeners = new Set<() => void>();
  const actionSigner = { app: { name: "vetra agent vetra-agent", key: "did:key:z6MkAgent" } };
  return {
    listeners,
    actionSigner,
    openAgentSession: vi.fn(() => Promise.resolve({ actionSigner } as unknown as OpenSession)),
    getAgentBearer: vi.fn(() => Promise.resolve("bearer-1")),
    onAgentChange: vi.fn((_workdir: string, listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
}

const env = (more: Record<string, string> = {}) => ({
  PH_IDENTITY_HOME: join(root, "identities"),
  ...more,
});

describe("studioIdentity", () => {
  it("signs a local Studio's writes as its agent, opened at the first write", async () => {
    const agent = fakeAgent();
    const identity = await studioIdentity({ workdir, config: {} }, { agent, env: env() });
    // Nobody logged in: the pseudonym signs, made at the first write.
    expect(identity.signer.ready()).toBe(true);
    expect(agent.openAgentSession).not.toHaveBeenCalled();
    expect(await identity.signer.open()).toBe(agent.actionSigner);
    expect(agent.openAgentSession).toHaveBeenCalledWith(workdir, { cloud: false });
    expect(identity.legacyDocuments).toBe("sign-when-ready");
    expect(await identity.tokenProvider()).toBe("bearer-1");
  });

  it("waits for the owner's approval in a cloud Studio, and writes no legacy document", async () => {
    const agent = fakeAgent();
    const identity = await studioIdentity(
      { workdir, config: { environmentId: "env-1" } },
      { agent, env: env() },
    );
    expect(identity.signer.ready()).toBe(false);
    expect(identity.legacyDocuments).toBe("refuse");
  });

  it("reports the agent's changes through onSignerChange, until unsubscribed", async () => {
    const agent = fakeAgent();
    const identity = await studioIdentity({ workdir, config: {} }, { agent, env: env() });
    const listener = vi.fn();
    const unsubscribe = identity.onSignerChange(listener);
    for (const notify of agent.listeners) notify();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(agent.listeners.size).toBe(0);
  });
});
