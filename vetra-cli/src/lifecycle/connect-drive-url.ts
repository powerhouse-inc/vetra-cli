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
 *   - Renown URL — RENOWN_URL, else the cloud Renown (`cloudRenownUrl`), else
 *     the www.renown.id default, into `connect.renown.url`. The cloud switchboard only accepts a bearer whose
 *     delegation credential lives on the Renown it verifies against; logging
 *     in on the bundled www.renown.id puts the credential elsewhere, so every
 *     Deploy-view call 401s ("Credentials no longer valid") on staging. The
 *     embedded switchboard is pointed at the same Renown (RENOWN_URL) so the
 *     studio's own drive accepts that login too.
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
  /** Environment the embedded switchboard reads RENOWN_URL from. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
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

      // ONE Renown for the browser login and the embedded switchboard, or the
      // studio's own drive rejects its own login. RENOWN_URL wins over
      // cloudRenownUrl; neither set leaves both on the www.renown.id default.
      // Set here because onInit runs before the runtime starts the embedded
      // switchboard, whose reactor-api reads RENOWN_URL at startup.
      const env = options.env ?? process.env;
      const renownUrl = resolveStudioRenownUrl(
        env.RENOWN_URL,
        ctx.config.cloudRenownUrl,
        ctx.log,
      );
      if (renownUrl) env.RENOWN_URL = renownUrl;

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
          typeof ctx.config.environmentId === "string" &&
          ctx.config.environmentId
            ? ctx.config.environmentId
            : undefined;

        // Registry the studio's deploys stamp onto new envs: the flag, else
        // PH_REGISTRY_URL. Not vetra-app's bundled powerhouse.config.json (that
        // names the dev registry) and no default: unset leaves it out and the
        // Deploy view says so.
        const configuredRegistry =
          typeof ctx.config.registryUrl === "string" && ctx.config.registryUrl
            ? ctx.config.registryUrl
            : undefined;
        const packageRegistryUrl =
          configuredRegistry ?? (process.env.PH_REGISTRY_URL?.trim() || null);

        // The cloud switchboard the browser-side Deploy view talks to. Without
        // it the bundle falls back to its staging default, so a prod studio's
        // Deploy view sends prod credentials to staging (401).
        const cloudSwitchboardUrl =
          typeof ctx.config.cloudSwitchboardUrl === "string" &&
          ctx.config.cloudSwitchboardUrl
            ? ctx.config.cloudSwitchboardUrl
            : undefined;

        // Renown organisations (an org Studio's member roles; 1.12's Move into
        // an organisation picker). Unset outside a provisioned org Studio.
        const renownOrgsUrl =
          typeof ctx.config.renownOrgsUrl === "string" &&
          ctx.config.renownOrgsUrl
            ? ctx.config.renownOrgsUrl
            : undefined;

        const bundleDir = path.join(options.vetraAppDir, connectDir);
        try {
          patchRuntimeConfig(
            bundleDir,
            driveUrl,
            renownUrl ?? DEFAULT_CONNECT_RENOWN_URL,
            ctx.log,
          );
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
            cloudSwitchboardUrl,
            renownOrgsUrl,
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

/** The Renown login URL vetra-app's Connect bundle ships with. */
export const DEFAULT_CONNECT_RENOWN_URL = "https://www.renown.id/";

/**
 * The Renown both the browser login and the embedded switchboard use:
 * RENOWN_URL, else cloudRenownUrl (VETRA_CLOUD_RENOWN_URL), else undefined
 * (both keep the www.renown.id default). Warns when both are set and differ.
 */
export function resolveStudioRenownUrl(
  renownUrlEnv: unknown,
  cloudRenownUrl: unknown,
  log: Pick<Log, "warn">,
): string | undefined {
  const fromEnv = typeof renownUrlEnv === "string" ? renownUrlEnv.trim() : "";
  const fromCloud =
    typeof cloudRenownUrl === "string" ? cloudRenownUrl.trim() : "";
  if (fromEnv && fromCloud && fromEnv !== fromCloud) {
    log.warn(
      `[connect-drive-url] RENOWN_URL (${fromEnv}) and VETRA_CLOUD_RENOWN_URL (${fromCloud}) differ; the studio logs in on and verifies against RENOWN_URL.`,
    );
  }
  return fromEnv || fromCloud || undefined;
}

/**
 * Points `connect.drives.defaultDrives` in the runtime config at the live
 * drive and, when configured, `connect.renown.url` at the cloud Renown.
 */
function patchRuntimeConfig(
  bundleDir: string,
  driveUrl: string,
  renownUrl: string,
  log: Log,
): void {
  const configFile = path.join(bundleDir, "powerhouse.config.json");
  if (!existsSync(configFile)) {
    throw new Error(`Connect runtime config not found at ${configFile}`);
  }

  const config = JSON.parse(readFileSync(configFile, "utf8")) as {
    connect?: {
      drives?: { defaultDrives?: Array<{ url?: string | null }> };
      renown?: { url?: string };
    };
  };
  const connect = (config.connect ??= {});
  const drives = (connect.drives ??= {});
  const current = drives.defaultDrives?.[0];

  const driveChanged =
    current?.url !== driveUrl || drives.defaultDrives?.length !== 1;
  const renownChanged = connect.renown?.url !== renownUrl;

  if (!driveChanged && !renownChanged) {
    log.debug(
      `[connect-drive-url] Runtime config already points at ${driveUrl}; skipping drive URL.`,
    );
    return;
  }

  if (driveChanged) drives.defaultDrives = [{ ...current, url: driveUrl }];
  if (renownChanged) connect.renown = { ...connect.renown, url: renownUrl };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  if (driveChanged) {
    log.info(
      `[connect-drive-url] Pointed drive URL at ${driveUrl}. Reload your browser to apply.`,
    );
  }
  if (renownChanged) {
    log.info(
      `[connect-drive-url] Pointed Renown login at ${renownUrl}. Reload your browser and sign in again to apply.`,
    );
  }
}

// Writes the studio runtime config the Connect SPA fetches at load time. Kept
// uncompressed in the served bundle (see Dockerfile precompress).
function writeStudioConfig(
  bundleDir: string,
  previewServerUrl: string,
  environmentId: string | undefined,
  packageRegistryUrl: string | null,
  cloudSwitchboardUrl: string | undefined,
  renownOrgsUrl: string | undefined,
  log: Log,
): void {
  if (!existsSync(bundleDir)) {
    throw new Error(`Connect bundle not found at ${bundleDir}`);
  }
  const file = path.join(bundleDir, "studio.config.json");
  const config: {
    previewServerUrl: string;
    packageRegistryUrl?: string;
    environmentId?: string;
    cloudSwitchboardUrl?: string;
    renownOrgsUrl?: string;
  } = { previewServerUrl };
  if (packageRegistryUrl) config.packageRegistryUrl = packageRegistryUrl;
  if (environmentId) config.environmentId = environmentId;
  if (cloudSwitchboardUrl) config.cloudSwitchboardUrl = cloudSwitchboardUrl;
  if (renownOrgsUrl) config.renownOrgsUrl = renownOrgsUrl;
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
