/**
 * Stamps live URLs into vetra-app's prebuilt Connect bundle.
 *
 * Connect bakes `import.meta.env.PH_CONNECT_DEFAULT_DRIVES_URL` (and our
 * preview-server base) into its JS at build time and can't read them from a
 * runtime source. vetra-cli's drive id is a random UUID minted on first run,
 * and the proxy URL depends on local config — both unknown when vetra-app
 * was built. The package build stamps placeholder tokens into the bundle;
 * this hook swaps them for the live values once the embedded Switchboard
 * resolves the drive:
 *
 *   1. ph-clint emits `powerhouse:switchboard:ready` with the composed URLs
 *      (direct and, when the proxy is enabled, proxied).
 *   2. For each token we compare the target value against a cache file
 *      inside the bundle.
 *   3. If it differs, we string-replace the prior token (the placeholder on
 *      first run, the last-applied value afterwards) across the bundle's JS
 *      and rewrite the cache.
 *
 * Stamped tokens:
 *   - drive URL — the proxied `<proxy>/switchboard/d/<id>` when available,
 *     else the direct switchboard drive URL.
 *   - preview-server URL — `<proxy>/preview` when available, else the
 *     direct loopback port.
 *
 * No rebuild, no toolchain, no install — so it works in a published,
 * source-less install where `ph-cli connect build` cannot run. The browser
 * needs a reload after a change for the new URLs to take effect.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import {
  CONNECT_DRIVE_URL_PLACEHOLDER,
  PREVIEW_SERVER_URL_PLACEHOLDER,
} from "../constants.js";
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

interface TokenStamp {
  /** Human label for log lines. */
  label: string;
  /** Cache file inside the bundle holding the last-applied value. */
  cacheFile: string;
  /** Build-time placeholder replaced on first run. */
  placeholder: string;
  /** Live value to stamp. */
  value: string;
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

        const bundleDir = path.join(options.vetraAppDir, connectDir);
        const stamps: TokenStamp[] = [
          {
            label: "drive URL",
            cacheFile: ".default-drive-url",
            placeholder: CONNECT_DRIVE_URL_PLACEHOLDER,
            value: driveUrl,
          },
          {
            label: "preview-server URL",
            cacheFile: ".preview-server-url",
            placeholder: PREVIEW_SERVER_URL_PLACEHOLDER,
            value: previewServerUrl,
          },
        ];
        for (const stamp of stamps) {
          try {
            patchToken(bundleDir, stamp, ctx.log);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            ctx.log.error(`[connect-drive-url] ${message}`);
          }
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

function patchToken(bundleDir: string, stamp: TokenStamp, log: Log): void {
  const cacheFile = path.join(bundleDir, stamp.cacheFile);
  const cached = existsSync(cacheFile)
    ? readFileSync(cacheFile, "utf8").trim()
    : "";

  if (cached === stamp.value) {
    log.debug(
      `[connect-drive-url] Bundle already points at ${stamp.value}; skipping ${stamp.label}.`,
    );
    return;
  }

  const assetsDir = path.join(bundleDir, "assets");
  if (!existsSync(assetsDir)) {
    throw new Error(`Connect bundle not found at ${bundleDir}`);
  }

  // First run replaces the build-time placeholder; later runs replace the
  // value we last wrote.
  const search = cached || stamp.placeholder;

  let patched = 0;
  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith(".js")) continue;
    const file = path.join(assetsDir, name);
    const content = readFileSync(file, "utf8");
    if (!content.includes(search)) continue;
    writeFileSync(file, content.split(search).join(stamp.value));
    patched++;
  }

  if (patched === 0) {
    log.warn(
      `[connect-drive-url] No '${search}' token in ${bundleDir}; the bundle ` +
        `may not be built with the ${stamp.label} placeholder. Leaving cache unchanged.`,
    );
    return;
  }

  writeFileSync(cacheFile, stamp.value);
  log.info(
    `[connect-drive-url] Pointed ${stamp.label} at ${stamp.value} (${patched} file${
      patched === 1 ? "" : "s"
    }). Reload your browser to apply.`,
  );
}
