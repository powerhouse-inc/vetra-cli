// Stopgap: deployed image lacks ph on PATH; remove once the image/builder installs ph-cmd globally.

/**
 * Ensures the `ph` bin is runnable before any command (e.g.
 * `reactor-project-init`, which shells out to bare `ph init`) executes.
 *
 * `ph` is provided by the unscoped `ph-cmd` package. The deployed
 * clint-agent image installs only `vetra-cli` and never puts `ph` on PATH,
 * so this hook checks for it on boot and, when missing, runs
 * `pnpm add -g ph-cmd@<DEFAULT_PH_VERSION>` (against `$CLINT_REGISTRY` when
 * set). It re-verifies afterwards and throws on failure — `onInit` errors
 * halt startup, which is preferable to a later cryptic `ph: not found`.
 *
 * No-op when `ph` already resolves, so it's safe to run every boot.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LifecycleHook, Logger } from "@powerhousedao/ph-clint";
import { DEFAULT_PH_VERSION } from "../constants.js";

const execFileAsync = promisify(execFile);

const CHECK_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 300_000;

async function run(
  command: string,
  args: string[],
  timeout: number,
): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { success: true, output: `${stdout}${stderr}` };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { success: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}` };
  }
}

/** True when a `ph` bin resolves and `ph --version` exits 0. */
async function phAvailable(): Promise<boolean> {
  const { success } = await run("ph", ["--version"], CHECK_TIMEOUT_MS);
  return success;
}

export function ensurePh(): LifecycleHook {
  return {
    name: "ensure-ph",
    async onInit(ctx) {
      const log: Logger = ctx.log;

      if (await phAvailable()) {
        log.debug("[ensure-ph] ph already on PATH; skipping install");
        return {};
      }

      const registry = process.env.CLINT_REGISTRY;
      const spec = `ph-cmd@${DEFAULT_PH_VERSION}`;
      const args = ["add", "-g", spec, ...(registry ? ["--registry", registry] : [])];
      log.info(
        `[ensure-ph] ph not found; installing ${spec}` +
          (registry ? ` from ${registry}` : "") +
          ` (pnpm ${args.join(" ")})`,
      );

      const { success, output } = await run("pnpm", args, INSTALL_TIMEOUT_MS);
      if (!success) {
        throw new Error(
          `[ensure-ph] failed to install ${spec}: ${output.trim()}`,
        );
      }

      if (!(await phAvailable())) {
        throw new Error(
          `[ensure-ph] installed ${spec} but \`ph\` still does not resolve on PATH`,
        );
      }
      log.info(`[ensure-ph] installed ${spec}; ph now resolves`);
      return {};
    },
  };
}
