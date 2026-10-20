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
) {
  const vetraAppDir = mkdtempSync(path.join(tmpdir(), "vetra-app-"));
  const bundleDir = path.join(vetraAppDir, "dist/connect");
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    path.join(bundleDir, "powerhouse.config.json"),
    JSON.stringify({
      connect: {
        renown: { url: "https://www.renown.id/" },
        drives: { defaultDrives: [{ url: "http://__ph_drive__" }] },
      },
    }),
  );
  const handlers: Array<(e: unknown) => void> = [];
  const ctx = {
    config,
    log: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
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
  return { runtime, env };
}

describe("connect-drive-url Renown instance", () => {
  it("points Connect's login at the configured cloud Renown", async () => {
    const { runtime } = await runtimeConfigAfterReady({
      cloudRenownUrl: "https://renown-staging.vetra.io",
    });
    expect(runtime.connect.renown.url).toBe("https://renown-staging.vetra.io");
    expect(runtime.connect.drives.defaultDrives[0]?.url).toBe(READY.proxy.driveUrl);
  });

  it("makes the embedded switchboard verify against the same Renown", async () => {
    const { env } = await runtimeConfigAfterReady({
      cloudRenownUrl: "https://renown-staging.vetra.io",
    });
    expect(env.RENOWN_URL).toBe("https://renown-staging.vetra.io");
  });

  it("never overrides an explicit RENOWN_URL", async () => {
    const { env } = await runtimeConfigAfterReady(
      { cloudRenownUrl: "https://renown-staging.vetra.io" },
      { RENOWN_URL: "https://renown.example" },
    );
    expect(env.RENOWN_URL).toBe("https://renown.example");
  });

  it("keeps the bundled Renown when no cloud Renown is configured", async () => {
    const { runtime, env } = await runtimeConfigAfterReady({});
    expect(runtime.connect.renown.url).toBe("https://www.renown.id/");
    expect(env).not.toHaveProperty("RENOWN_URL");
  });
});
