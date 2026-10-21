/**
 * The daemon stamps the browser's create policy and the Studio drive id
 * (Task 5.SIG, ruling X39): the browser can never create a legacy document in
 * a v2 Studio by guessing wrong.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import {
  connectDriveUrlOnSwitchboardReady,
  driveIdFromUrl,
  setStudioDriveId,
  stampCreateSignaturePolicy,
} from "../../src/lifecycle/connect-drive-url.js";

let root: string;
let bundleDir: string;
const log = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "connect-signing-"));
  bundleDir = path.join(root, "dist/connect");
  mkdirSync(bundleDir, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeConfig(config: unknown): void {
  writeFileSync(
    path.join(bundleDir, "powerhouse.config.json"),
    JSON.stringify(config, null, 2),
  );
}

function readConfig(): {
  connect: {
    reactor?: { createSignaturePolicy?: string };
    drives?: { defaultDrives?: Array<{ url?: string }> };
  };
} {
  return JSON.parse(readFileSync(path.join(bundleDir, "powerhouse.config.json"), "utf8"));
}

describe("stampCreateSignaturePolicy", () => {
  it("stamps v2-required for a new cloud Studio", () => {
    writeConfig({ connect: { drives: { defaultDrives: [{ url: "/d/old" }] } } });
    stampCreateSignaturePolicy(root, "v2-required", "dist/connect", log);
    const config = readConfig();
    expect(config.connect.reactor?.createSignaturePolicy).toBe("v2-required");
    // Other Connect settings survive.
    expect(config.connect.drives?.defaultDrives?.[0]?.url).toBe("/d/old");
  });

  it("stamps legacy for a local Studio", () => {
    writeConfig({ connect: {} });
    stampCreateSignaturePolicy(root, "legacy", "dist/connect", log);
    expect(readConfig().connect.reactor?.createSignaturePolicy).toBe("legacy");
  });

  it("is a no-op when the bundle has no runtime config", () => {
    expect(() =>
      stampCreateSignaturePolicy(root, "v2-required", "dist/connect", log),
    ).not.toThrow();
  });
});

describe("studioDriveId", () => {
  it("derives the id from the stamped drive URL", () => {
    expect(driveIdFromUrl("https://s.vetra.io/switchboard/d/abc123")).toBe("abc123");
    expect(driveIdFromUrl("http://localhost:4001/d/x?y=1")).toBe("x");
    expect(driveIdFromUrl("http://localhost:4001/d/")).toBeUndefined();
  });

  it("records the id in studio.config.json and skips an unchanged one", () => {
    writeFileSync(
      path.join(bundleDir, "studio.config.json"),
      JSON.stringify({ previewServerUrl: "https://s.vetra.io/preview" }),
    );
    setStudioDriveId(bundleDir, "drive-1", log);
    const config = JSON.parse(
      readFileSync(path.join(bundleDir, "studio.config.json"), "utf8"),
    );
    expect(config.studioDriveId).toBe("drive-1");
    expect(config.previewServerUrl).toBe("https://s.vetra.io/preview");
  });
});

describe("connect-drive-url stamps the Studio drive id", () => {
  it("writes studioDriveId next to the drive URL", async () => {
    writeConfig({ connect: {} });
    writeFileSync(
      path.join(bundleDir, "studio.config.json"),
      JSON.stringify({ previewServerUrl: "https://s.vetra.io/preview" }),
    );
    const handlers: Array<(e: unknown) => void> = [];
    const ctx = {
      config: { environmentId: "env-1" },
      log,
      eventBus: {
        on: (_: string, h: (e: unknown) => void) => handlers.push(h),
        off: () => {},
      },
    } as unknown as Parameters<LifecycleHook["onInit"]>[0];

    await connectDriveUrlOnSwitchboardReady({ vetraAppDir: root }).onInit(ctx);
    for (const h of handlers) {
      h({ driveUrl: "https://s.vetra.io/switchboard/d/drive-9" });
    }

    const studio = JSON.parse(
      readFileSync(path.join(bundleDir, "studio.config.json"), "utf8"),
    );
    expect(studio.studioDriveId).toBe("drive-9");
    expect(readConfig().connect.drives?.defaultDrives?.[0]?.url).toBe(
      "https://s.vetra.io/switchboard/d/drive-9",
    );
  });
});
