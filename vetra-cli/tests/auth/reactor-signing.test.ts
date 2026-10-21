/**
 * The signing wiring of a new cloud Studio (Task 5.SIG, ruling X39): the live
 * Renown signer, the v2 create policy, the refusal rule, the drive pointer.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IRenown } from "@renown/sdk/node";
import {
  cloudStudioDriveConfig,
  readStudioDrivePointer,
  signerHasUser,
  studioReactorSigning,
  writeStudioDrivePointer,
} from "../../src/auth/reactor-signing.js";

const OWNER = "0xabc0000000000000000000000000000000000001";

function fakeRenown(address?: string) {
  const listeners = new Set<() => void>();
  const signer: {
    user?: { address: string };
    app: { key: string };
    signAction: jest.Mock;
  } = {
    user: address ? { address } : undefined,
    app: { key: "did:key:z6MkAgent" },
    signAction: jest.fn(() => Promise.resolve([])),
  };
  const renown = {
    signer,
    on: (_event: "user", listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setAddress(next?: string) {
      signer.user = next ? { address: next } : undefined;
      for (const listener of listeners) listener();
    },
  };
  return { renown, signer, listeners };
}

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "reactor-signing-"));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("studioReactorSigning", () => {
  it("signs with the live Renown signer and creates v2-required documents", async () => {
    const { renown, signer } = fakeRenown(OWNER);

    const { signing } = await studioReactorSigning({
      workdir,
      renownUrl: "https://renown.test",
      adminsEnv: OWNER,
      renown: renown as unknown as IRenown,
    });

    expect(signing.signer).toBe(signer as never);
    expect(signing.createSignaturePolicy).toBe("v2-required");
    expect(signing.legacyDocuments).toBe("refuse");
    expect(typeof signing.trustPolicy?.authorizeSigner).toBe("function");
  });

  it("announces readiness when the signer gains its user", async () => {
    const { renown } = fakeRenown(undefined);
    const { signing } = await studioReactorSigning({
      workdir,
      renownUrl: "https://renown.test",
      adminsEnv: OWNER,
      renown: renown as unknown as IRenown,
    });
    const ready = jest.fn();
    const off = signing.onSignerChange?.(ready);
    renown.setAddress(OWNER);
    expect(ready).toHaveBeenCalledTimes(1);
    off?.();
    renown.setAddress(undefined);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("knows when the signer cannot sign yet", () => {
    const { signer } = fakeRenown(undefined);
    expect(signerHasUser(signer)).toBe(false);
    signer.user = { address: OWNER };
    expect(signerHasUser(signer)).toBe(true);
  });
});

describe("cloudStudioDriveConfig", () => {
  it("never matches a drive by name (a legacy Home must not be adopted)", () => {
    const config = cloudStudioDriveConfig(workdir);
    expect(config.matchByName).toBe(false);
  });

  it("defers creation until the host may create", async () => {
    let ready = false;
    const config = cloudStudioDriveConfig(workdir, { canCreate: () => ready });
    expect(config.canCreate?.()).toBe(false);
    ready = true;
    expect(config.canCreate?.()).toBe(true);
  });

  it("resolves through the pointer and records a created drive", async () => {
    const config = cloudStudioDriveConfig(workdir);
    const client = {
      get: jest.fn(() => Promise.resolve({ header: { id: "drive-1" } })),
    };
    await expect(config.resolveId?.(client as never)).resolves.toBeUndefined();

    await config.onCreated?.("drive-1");
    expect(readStudioDrivePointer(workdir)).toBe("drive-1");
    await expect(config.resolveId?.(client as never)).resolves.toBe("drive-1");
  });

  it("ignores a pointer to a drive that no longer exists", async () => {
    writeStudioDrivePointer(workdir, "gone");
    const config = cloudStudioDriveConfig(workdir);
    const client = { get: jest.fn(() => Promise.reject(new Error("not found"))) };
    await expect(config.resolveId?.(client as never)).resolves.toBeUndefined();
  });
});
