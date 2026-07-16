/**
 * Stamps live URLs into vetra-app's prebuilt Connect bundle.
 *
 * vetra's drive id is a random UUID minted on first run, and the proxy
 * URL depends on local config — both unknown when vetra-app was built. Once
 * the embedded Switchboard resolves the drive (ph-clint emits
 * `powerhouse:switchboard:ready` with the composed URLs — direct and, when
 * the proxy is enabled, proxied), this hook writes the live values into the
 * bundle:
 *
 *   - drive URL — the proxied `<proxy>/switchboard/d/<id>` when available,
 *     else the direct switchboard drive URL. Written into the bundle's
 *     runtime config (`powerhouse.config.json` →
 *     `connect.drives.defaultDrives`), which Connect reads at load time.
 *   - preview-server URL (+ the package registry deploys stamp onto new envs)
 *     — `<proxy>/preview` when available, else the direct loopback port.
 *     Written into `studio.config.json`, which vetra-app's
 *     `preview-server-client.ts` fetches at load time. Both are
 *     JSON configs the SPA reads at runtime — no JS asset is mutated, so the
 *     served bundle stays byte-identical to the build (the image's
 *     precompressed siblings exclude these two configs; see the Dockerfile).
 *
 * No rebuild, no toolchain, no install — so it works in a published,
 * source-less install where `ph-cli connect build` cannot run. The browser
 * needs a reload after a change for the new URLs to take effect.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import { resolveRegistryUrl } from "@powerhousedao/shared/registry";
import { DEFAULT_PREVIEW_SERVER_PORT } from "../preview-server/index.js";

interface SwitchboardReadyEvent {
  switchboardUrl: string;
  driveUrl: string;
  mcpUrl?: string;
  /** Browser-facing equivalents through the embedded proxy, when enabled. */
  proxy?: {
    url: string;
    switchboardUrl: string;
    driveUrl: string;
    mcpUrl: string;
  };
}

interface ConnectDriveUrlOptions {
  /** Path to the vetra-app package root. */
  vetraAppDir: string;
  /** Relative path to the prebuilt Connect bundle. Defaults to "dist/connect". */
  connectDir?: string;
}

interface Log {
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export function connectDriveUrlOnSwitchboardReady(
  options: ConnectDriveUrlOptions,
): LifecycleHook {
  const connectDir = options.connectDir ?? "dist/connect";

  return {
    name: "connect-drive-url",
    onInit(ctx) {
      let handled = false;

      const handler = (raw: unknown) => {
        if (handled) return;
        const event = raw as SwitchboardReadyEvent | undefined;
        // Prefer the proxied URLs — the bundle runs in the browser, which in
        // a deployed agent can only reach the proxy port.
        const driveUrl = event?.proxy?.driveUrl ?? event?.driveUrl;
        if (!driveUrl) return;
        handled = true;

        const previewServerUrl = event?.proxy
          ? `${event.proxy.url}/preview`
          : `http://127.0.0.1:${DEFAULT_PREVIEW_SERVER_PORT}`;

        const environmentId =
          typeof ctx.config.environmentId === "string" && ctx.config.environmentId
            ? ctx.config.environmentId
            : undefined;

        // Registry the studio's deploys stamp onto new envs (flag >
        // PH_REGISTRY_URL > vetra-app powerhouse.config.json > default).
        const configuredRegistry =
          typeof ctx.config.registryUrl === "string" && ctx.config.registryUrl
            ? ctx.config.registryUrl
            : undefined;
        const packageRegistryUrl = resolveRegistryUrl({
          registry: configuredRegistry,
          projectPath: options.vetraAppDir,
        });

        const bundleDir = path.join(options.vetraAppDir, connectDir);
        try {
          patchDefaultDrive(bundleDir, driveUrl, ctx.log);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.log.error(`[connect-drive-url] ${message}`);
        }
        try {
          writeStudioConfig(
            bundleDir,
            previewServerUrl,
            environmentId,
            packageRegistryUrl,
            ctx.log,
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.log.error(`[connect-drive-url] ${message}`);
        }
      };

      ctx.eventBus.on("powerhouse:switchboard:ready", handler);

      return {
        shutdown: async () => {
          ctx.eventBus.off("powerhouse:switchboard:ready", handler);
        },
      };
    },
  };
}

/** Points `connect.drives.defaultDrives` in the runtime config at the live drive. */
function patchDefaultDrive(
  bundleDir: string,
  driveUrl: string,
  log: Log,
): void {
  const configFile = path.join(bundleDir, "powerhouse.config.json");
  if (!existsSync(configFile)) {
    throw new Error(`Connect runtime config not found at ${configFile}`);
  }

  const config = JSON.parse(readFileSync(configFile, "utf8")) as {
    connect?: {
      drives?: { defaultDrives?: Array<{ url?: string | null }> };
    };
  };
  const connect = (config.connect ??= {});
  const drives = (connect.drives ??= {});
  const current = drives.defaultDrives?.[0];

  if (current?.url === driveUrl && drives.defaultDrives?.length === 1) {
    log.debug(
      `[connect-drive-url] Runtime config already points at ${driveUrl}; skipping drive URL.`,
    );
    return;
  }

  drives.defaultDrives = [{ ...current, url: driveUrl }];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  log.info(
    `[connect-drive-url] Pointed drive URL at ${driveUrl}. Reload your browser to apply.`,
  );
}

// Writes the studio runtime config the Connect SPA fetches at load time. Kept
// uncompressed in the served bundle (see Dockerfile precompress).
function writeStudioConfig(
  bundleDir: string,
  previewServerUrl: string,
  environmentId: string | undefined,
  packageRegistryUrl: string,
  log: Log,
): void {
  if (!existsSync(bundleDir)) {
    throw new Error(`Connect bundle not found at ${bundleDir}`);
  }
  const file = path.join(bundleDir, "studio.config.json");
  const config: {
    previewServerUrl: string;
    packageRegistryUrl: string;
    environmentId?: string;
  } = { previewServerUrl, packageRegistryUrl };
  if (environmentId) config.environmentId = environmentId;
  const next = `${JSON.stringify(config, null, 2)}\n`;

  if (existsSync(file) && readFileSync(file, "utf8") === next) {
    log.debug(
      `[connect-drive-url] studio.config.json already points at ${previewServerUrl}; skipping.`,
    );
    return;
  }

  writeFileSync(file, next);
  log.info(
    `[connect-drive-url] Wrote studio.config.json (preview-server ${previewServerUrl}). Reload your browser to apply.`,
  );
}
