/**
 * Rebuilds vetra-app's Connect SPA bundle with the live drive URL baked in.
 *
 * The embedded Connect reads `import.meta.env.PH_CONNECT_DEFAULT_DRIVES_URL`
 * at build time, but vetra-cli's drive id is a random UUID generated on
 * first run — unknown when vetra-app was built. This hook closes the gap:
 *
 *   1. On startup, ph-clint emits `powerhouse:switchboard:ready` once the
 *      embedded Switchboard has resolved the drive id and composed the URL.
 *   2. We compare that URL with a cache file inside the existing bundle.
 *   3. If they differ, we spawn `ph-cli connect build` against vetra-app
 *      with the URL stamped into the env. The bundle now auto-adds the
 *      vetra-cli drive on next page load.
 *
 * Trade-offs: the very first run (and any run after the drive id changes)
 * starts vetra-cli with a stale bundle, kicks the rebuild off in the
 * background, and asks the user to reload their browser once the rebuild
 * completes. Subsequent runs read the cache and skip the rebuild — no
 * startup penalty.
 *
 * Detection is intentionally narrow: we only compare the live drive URL
 * with what we built last. Source changes in vetra-app aren't detected —
 * the developer's normal `pnpm build` + `ph-cli connect build` cycle is
 * the right place for those.
 *
 * If a less disruptive option appears (a Switchboard alias URL, runtime
 * injection from connect-server, etc.) this hook is the first thing to
 * delete.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LifecycleHook } from "@powerhousedao/ph-clint";

interface SwitchboardReadyEvent {
  switchboardUrl: string;
  driveUrl: string;
  mcpUrl?: string;
}

interface ConnectRebuildOptions {
  /** Path to the vetra-app package root. */
  vetraAppDir: string;
  /** Relative outDir passed to `ph-cli connect build`. Defaults to "dist/connect". */
  outDir?: string;
}

export function connectRebuildOnSwitchboardReady(
  options: ConnectRebuildOptions,
): LifecycleHook {
  const outDir = options.outDir ?? "dist/connect";

  return {
    name: "connect-rebuild",
    onInit(ctx) {
      let handled = false;

      const handler = (raw: unknown) => {
        if (handled) return;
        const event = raw as SwitchboardReadyEvent | undefined;
        const driveUrl = event?.driveUrl;
        if (!driveUrl) return;
        handled = true;

        // Fire and forget. The rebuild outlives this event handler; failures
        // are surfaced via the logger but never thrown.
        void runRebuild(options.vetraAppDir, outDir, driveUrl, ctx.log).catch(
          (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            ctx.log.error(`[connect-rebuild] ${message}`);
          },
        );
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

async function runRebuild(
  vetraAppDir: string,
  outDir: string,
  driveUrl: string,
  log: {
    info: (msg: string) => void;
    debug: (msg: string) => void;
    error: (msg: string) => void;
  },
): Promise<void> {
  const cacheFile = path.join(vetraAppDir, outDir, ".default-drive-url");
  const cached = existsSync(cacheFile)
    ? readFileSync(cacheFile, "utf8").trim()
    : "";

  if (cached === driveUrl) {
    log.debug(
      `[connect-rebuild] Bundle already built for ${driveUrl}; skipping.`,
    );
    return;
  }

  log.info(`[connect-rebuild] Rebuilding Connect with default drive URL...`);
  log.info(`  drive: ${driveUrl}`);

  let stderr = "";
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "pnpm",
      [
        "exec",
        "ph-cli",
        "connect",
        "build",
        "--outDir",
        outDir,
        "--default-drives-url",
        driveUrl,
      ],
      {
        cwd: vetraAppDir,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          PH_CONNECT_DEFAULT_DRIVES_URL: driveUrl,
        },
      },
    );
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else {
        const trimmed = stderr.trim();
        if (trimmed) log.error(trimmed);
        reject(new Error(`ph-cli connect build exited with code ${code}`));
      }
    });
  });

  writeFileSync(cacheFile, driveUrl);
  log.info("[connect-rebuild] ✓ Bundle rebuilt. Reload your browser to apply.");
}
