/**
 * Stamps the live drive URL into vetra-app's prebuilt Connect bundle.
 *
 * Connect bakes `import.meta.env.PH_CONNECT_DEFAULT_DRIVES_URL` into its JS at
 * build time and can't read it from a runtime source. vetra-cli's drive id is
 * a random UUID minted on first run, unknown when vetra-app was built. The
 * package build stamps `CONNECT_DRIVE_URL_PLACEHOLDER` into the bundle; this
 * hook swaps it for the live URL once the embedded Switchboard resolves the
 * drive:
 *
 *   1. ph-clint emits `powerhouse:switchboard:ready` with the composed URL.
 *   2. We compare it against a cache file inside the bundle.
 *   3. If it differs, we string-replace the prior token (the placeholder on
 *      first run, the last-applied URL afterwards) across the bundle's JS and
 *      rewrite the cache.
 *
 * No rebuild, no toolchain, no install — so it works in a published,
 * source-less install where `ph-cli connect build` cannot run. The browser
 * needs a reload after a change for the new URL to take effect.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import { CONNECT_DRIVE_URL_PLACEHOLDER } from "../constants.js";

interface SwitchboardReadyEvent {
  switchboardUrl: string;
  driveUrl: string;
  mcpUrl?: string;
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
        const driveUrl = event?.driveUrl;
        if (!driveUrl) return;
        handled = true;

        try {
          patchDriveUrl(
            path.join(options.vetraAppDir, connectDir),
            driveUrl,
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

function patchDriveUrl(bundleDir: string, driveUrl: string, log: Log): void {
  const cacheFile = path.join(bundleDir, ".default-drive-url");
  const cached = existsSync(cacheFile)
    ? readFileSync(cacheFile, "utf8").trim()
    : "";

  if (cached === driveUrl) {
    log.debug(
      `[connect-drive-url] Bundle already points at ${driveUrl}; skipping.`,
    );
    return;
  }

  const assetsDir = path.join(bundleDir, "assets");
  if (!existsSync(assetsDir)) {
    throw new Error(`Connect bundle not found at ${bundleDir}`);
  }

  // First run replaces the build-time placeholder; later runs replace the URL
  // we last wrote.
  const search = cached || CONNECT_DRIVE_URL_PLACEHOLDER;

  let patched = 0;
  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith(".js")) continue;
    const file = path.join(assetsDir, name);
    const content = readFileSync(file, "utf8");
    if (!content.includes(search)) continue;
    writeFileSync(file, content.split(search).join(driveUrl));
    patched++;
  }

  if (patched === 0) {
    log.warn(
      `[connect-drive-url] No '${search}' token in ${bundleDir}; the bundle ` +
        `may not be built with the placeholder. Leaving cache unchanged.`,
    );
    return;
  }

  writeFileSync(cacheFile, driveUrl);
  log.info(
    `[connect-drive-url] Pointed Connect at ${driveUrl} (${patched} file${
      patched === 1 ? "" : "s"
    }). Reload your browser to apply.`,
  );
}
