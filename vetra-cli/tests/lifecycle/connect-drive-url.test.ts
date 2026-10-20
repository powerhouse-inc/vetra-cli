/**
 * connect-drive-url: the studio runtime config (studio.config.json) the
 * browser bundle reads must carry the cloud switchboard the agent is pointed
 * at, so a prod studio's Deploy view doesn't fall back to staging (401).
 */
import { describe, it, expect, jest } from "@jest/globals";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * The cloud switchboard only accepts a Renown bearer whose delegation
 * credential lives on the Renown instance IT verifies against (staging:
 * renown-staging.vetra.io). The bundled Connect logs in via www.renown.id, so
 * on staging the credential is on the wrong Renown and every Deploy-view call
 * 401s ("Credentials no longer valid"). The studio must log in on the Renown
 * the agent's cloud is configured with (cloudRenownUrl), and its embedded
 * switchboard must verify against the same one.
 */
async function runtimeConfigAfterReady(
  config: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
  bundledRenownUrl = "https://www.renown.id/",
) {
  const vetraAppDir = mkdtempSync(path.join(tmpdir(), "vetra-app-"));
  const bundleDir = path.join(vetraAppDir, "dist/connect");
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    path.join(bundleDir, "powerhouse.config.json"),
    JSON.stringify({
      connect: {
        renown: { url: bundledRenownUrl },
        drives: { defaultDrives: [{ url: "http://__ph_drive__" }] },
      },
    }),
  );
  const handlers: Array<(e: unknown) => void> = [];
  const log = {
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  };
  const ctx = {
    config,
    log,
    eventBus: {
      on: (_: string, h: (e: unknown) => void) => handlers.push(h),
      off: () => {},
    },
  } as unknown as Parameters<LifecycleHook["onInit"]>[0];

  await connectDriveUrlOnSwitchboardReady({ vetraAppDir, env }).onInit(ctx);
  for (const h of handlers) h(READY);
  const runtime = JSON.parse(
    readFileSync(path.join(bundleDir, "powerhouse.config.json"), "utf8"),
  ) as {
    connect: {
      renown: { url: string };
      drives: { defaultDrives: Array<{ url: string }> };
    };
  };
  return { runtime, env, log };
}

describe("connect-drive-url Renown instance", () => {
  const STAGING = "https://renown-staging.vetra.io";
  const OTHER = "https://renown.example";
  const DEFAULT = "https://www.renown.id/";

  it.each([
    ["neither set", {}, {}, undefined, DEFAULT],
    ["only cloudRenownUrl", { cloudRenownUrl: STAGING }, {}, STAGING, STAGING],
    ["only RENOWN_URL", {}, { RENOWN_URL: OTHER }, OTHER, OTHER],
    ["both, differing (RENOWN_URL wins)", { cloudRenownUrl: STAGING }, { RENOWN_URL: OTHER }, OTHER, OTHER],
  ] as const)(
    "%s: browser login and embedded switchboard use the same Renown",
    async (_, config, env, switchboardUrl, browserUrl) => {
      const { runtime, env: out } = await runtimeConfigAfterReady(
        { ...config },
        { ...env },
      );
      expect(out.RENOWN_URL).toBe(switchboardUrl);
      expect(runtime.connect.renown.url).toBe(browserUrl);
      expect(runtime.connect.drives.defaultDrives[0]?.url).toBe(
        READY.proxy.driveUrl,
      );
    },
  );

  it("warns naming both URLs when they differ", async () => {
    const { log } = await runtimeConfigAfterReady(
      { cloudRenownUrl: STAGING },
      { RENOWN_URL: OTHER },
    );
    const warning = String(log.warn.mock.calls[0]?.[0]);
    expect(warning).toContain(OTHER);
    expect(warning).toContain(STAGING);
  });

  it("restores the default login when a previous run stamped another Renown", async () => {
    const { runtime } = await runtimeConfigAfterReady(
      {},
      {},
      "https://renown-staging.vetra.io",
    );
    expect(runtime.connect.renown.url).toBe(DEFAULT);
  });
});
