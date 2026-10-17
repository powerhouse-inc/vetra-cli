/**
 * connect-drive-url: the studio runtime config (studio.config.json) the
 * browser bundle reads must carry the cloud switchboard the agent is pointed
 * at, so a prod studio's Deploy view doesn't fall back to staging (401).
 */
import { describe, it, expect, jest } from "@jest/globals";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import { connectDriveUrlOnSwitchboardReady } from "../../src/lifecycle/connect-drive-url.js";

const READY = {
  switchboardUrl: "http://localhost:4001/graphql",
  driveUrl: "http://localhost:4001/d/drive",
  proxy: {
    url: "https://vivid-slug.vetra.io",
    switchboardUrl: "https://vivid-slug.vetra.io/switchboard/graphql",
    driveUrl: "https://vivid-slug.vetra.io/switchboard/d/drive",
    mcpUrl: "https://vivid-slug.vetra.io/switchboard/mcp",
  },
};

async function studioConfigAfterReady(config: Record<string, unknown>) {
  const vetraAppDir = mkdtempSync(path.join(tmpdir(), "vetra-app-"));
  mkdirSync(path.join(vetraAppDir, "dist/connect"), { recursive: true });
  const handlers: Array<(e: unknown) => void> = [];
  const ctx = {
    config,
    log: {
      warn: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    },
    eventBus: {
      on: (_: string, h: (e: unknown) => void) => handlers.push(h),
      off: () => {},
    },
  } as unknown as Parameters<LifecycleHook["onInit"]>[0];

  await connectDriveUrlOnSwitchboardReady({ vetraAppDir }).onInit(ctx);
  for (const h of handlers) h(READY);
  return JSON.parse(
    readFileSync(
      path.join(vetraAppDir, "dist/connect/studio.config.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

describe("connect-drive-url studio.config.json", () => {
  it("records the configured cloud switchboard for the Deploy view", async () => {
    const cfg = await studioConfigAfterReady({
      environmentId: "env-1",
      cloudSwitchboardUrl: "https://switchboard.vetra.io",
    });
    expect(cfg.cloudSwitchboardUrl).toBe("https://switchboard.vetra.io");
    expect(cfg.environmentId).toBe("env-1");
    expect(cfg.previewServerUrl).toBe("https://vivid-slug.vetra.io/preview");
  });

  it("omits it when unset, so the bundle keeps its default", async () => {
    const cfg = await studioConfigAfterReady({});
    expect(cfg).not.toHaveProperty("cloudSwitchboardUrl");
  });
});
