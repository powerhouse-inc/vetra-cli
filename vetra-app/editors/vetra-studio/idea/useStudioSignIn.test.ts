import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoizeUntilLoaded } from "../hooks/preview-server-client.js";
import {
  isCloudStudioHost,
  resolveSignInRequired,
  signInStatus,
} from "./useStudioSignIn.js";

const hoisted = vi.hoisted(() => ({
  load: vi.fn<
    () => Promise<{ loaded: boolean; environmentId: string | null }>
  >(),
}));

vi.mock("../hooks/preview-server-client.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveStudioConfigLoad: () => hoisted.load(),
}));

describe("signInStatus", () => {
  it("is checking until the Studio's config is read", () => {
    expect(signInStatus(null, "authorized")).toBe("checking");
  });

  it("needs no sign-in on a Studio that runs on the customer's machine", () => {
    expect(signInStatus(false, "not-authorized")).toBe("signed-in");
  });

  it("follows Renown on a cloud Studio", () => {
    expect(signInStatus(true, "authorized")).toBe("signed-in");
    expect(signInStatus(true, "loading")).toBe("checking");
    expect(signInStatus(true, "checking")).toBe("checking");
    expect(signInStatus(true, "initial")).toBe("signed-out");
    expect(signInStatus(true, "not-authorized")).toBe("signed-out");
  });
});

describe("resolveSignInRequired", () => {
  beforeEach(() => {
    hoisted.load.mockReset();
  });

  const unread = () =>
    hoisted.load.mockResolvedValue({ loaded: false, environmentId: null });

  it("fails closed on a cloud Studio host when the config can't be read", async () => {
    unread();
    expect(await resolveSignInRequired("rapid-fox.staging.vetra.io")).toBe(
      true,
    );
    expect(await resolveSignInRequired("rapid-fox.vetra.io")).toBe(true);
    hoisted.load.mockRejectedValue(new Error("network down"));
    expect(await resolveSignInRequired("rapid-fox.vetra.io")).toBe(true);
  });

  it("needs no sign-in on other hosts when the config can't be read", async () => {
    unread();
    expect(await resolveSignInRequired("localhost")).toBe(false);
    expect(await resolveSignInRequired("127.0.0.1")).toBe(false);
    hoisted.load.mockRejectedValue(new Error("network down"));
    expect(await resolveSignInRequired("localhost")).toBe(false);
  });

  it("follows the config once read, whatever the host", async () => {
    hoisted.load.mockResolvedValue({ loaded: true, environmentId: "env-1" });
    expect(await resolveSignInRequired("localhost")).toBe(true);
    hoisted.load.mockResolvedValue({ loaded: true, environmentId: null });
    expect(await resolveSignInRequired("fox.vetra.io")).toBe(false);
  });
});

describe("memoizeUntilLoaded", () => {
  it("retries a load that failed and keeps one that loaded", async () => {
    const load = vi
      .fn<() => Promise<{ loaded: boolean }>>()
      .mockResolvedValueOnce({ loaded: false })
      .mockResolvedValue({ loaded: true });
    const resolve = memoizeUntilLoaded(load);
    expect(await resolve()).toEqual({ loaded: false });
    expect(await resolve()).toEqual({ loaded: true });
    expect(await resolve()).toEqual({ loaded: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares a load that is still running", async () => {
    const load = vi.fn(() => Promise.resolve({ loaded: true }));
    const resolve = memoizeUntilLoaded(load);
    await Promise.all([resolve(), resolve()]);
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("isCloudStudioHost", () => {
  it("matches every stack's Studio hosts only", () => {
    expect(isCloudStudioHost("fox.staging.vetra.io")).toBe(true);
    expect(isCloudStudioHost("FOX.VETRA.IO")).toBe(true);
    expect(isCloudStudioHost("localhost")).toBe(false);
    expect(isCloudStudioHost("vetra.io.example.com")).toBe(false);
  });
});
