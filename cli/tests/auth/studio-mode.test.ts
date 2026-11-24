/**
 * The cloud-Studio signal and the signature mode, which is the switchboard's
 * create policy.
 */
import { describe, it, expect, vi } from "vitest";
import {
  environmentIdOf,
  isCloudStudio,
  studioSignatureMode,
  type StudioSignatureMode,
} from "../../src/auth/studio-mode.js";

describe("environmentIdOf", () => {
  it("prefers the config value, trimmed, and falls back to the env", () => {
    expect(environmentIdOf({ environmentId: " env-1 " }, {})).toBe("env-1");
    expect(environmentIdOf({}, { VETRA_ENVIRONMENT_ID: "env-2" })).toBe("env-2");
    expect(environmentIdOf({ environmentId: "  " }, {})).toBeUndefined();
    expect(environmentIdOf(undefined, {})).toBeUndefined();
  });
});

describe("isCloudStudio", () => {
  it("is true with an environment id, false on a local Studio", () => {
    expect(isCloudStudio({ environmentId: "env-1" }, {})).toBe(true);
    expect(isCloudStudio({}, { VETRA_ENVIRONMENT_ID: "env-2" })).toBe(true);
    expect(isCloudStudio({}, {})).toBe(false);
  });
});

function switchboard(policy: StudioSignatureMode) {
  return { client: { getCreateSignaturePolicy: vi.fn(() => Promise.resolve(policy)) } };
}

describe("studioSignatureMode", () => {
  it("is the switchboard's create policy, read once per client", async () => {
    const reactor = switchboard("v2-required");
    const log = { error: vi.fn() };
    const cloud = { environmentId: "env-1" };
    expect(await studioSignatureMode(reactor, cloud, log, {})).toBe("v2-required");
    expect(await studioSignatureMode(reactor, cloud, log, {})).toBe("v2-required");
    expect(reactor.client.getCreateSignaturePolicy).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    expect(await studioSignatureMode(switchboard("legacy"), {}, log, {})).toBe("legacy");
    expect(log.error).not.toHaveBeenCalled();
  });

  it("logs once when a cloud Studio is on a legacy switchboard", async () => {
    const reactor = switchboard("legacy");
    const log = { error: vi.fn() };
    expect(await studioSignatureMode(reactor, { environmentId: "env-1" }, log, {})).toBe("legacy");
    await studioSignatureMode(reactor, { environmentId: "env-1" }, log, {});
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(String(log.error.mock.calls[0][0])).toContain("v2-required");
  });

  it("logs nothing for a local Studio, which signs on either policy", async () => {
    const log = { error: vi.fn() };
    await studioSignatureMode(switchboard("v2-required"), {}, log, {});
    await studioSignatureMode(switchboard("legacy"), {}, log, {});
    expect(log.error).not.toHaveBeenCalled();
  });

  it("reads again after a failed read", async () => {
    const getCreateSignaturePolicy = vi
      .fn<() => Promise<StudioSignatureMode>>()
      .mockRejectedValueOnce(new Error("switchboard down"))
      .mockResolvedValueOnce("legacy");
    const reactor = { client: { getCreateSignaturePolicy } };
    await expect(studioSignatureMode(reactor, {}, undefined, {})).rejects.toThrow("switchboard down");
    expect(await studioSignatureMode(reactor, {}, undefined, {})).toBe("legacy");
  });
});
