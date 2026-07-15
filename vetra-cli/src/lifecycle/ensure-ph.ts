// Stopgap: deployed image lacks ph on PATH; remove once the image/builder installs ph-cmd globally.

// Ensures `ph` (from ph-cmd) is runnable on boot: installs DEFAULT_PH_VERSION
// when absent, else checks the present ph's version for compatibility.
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

/** `ph --version` output when a `ph` bin resolves and exits 0, else null. */
async function phVersionOutput(): Promise<string | null> {
  const { success, output } = await run("ph", ["--version"], CHECK_TIMEOUT_MS);
  return success ? output : null;
}

/** First `major.minor.patch` triple in a string (ignores any prerelease tag). */
function parseVersion(
  s: string,
): { major: number; minor: number; patch: number; version: string } | null {
  const m = s.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), version: m[0] };
}

const EXPECTED_PH = parseVersion(DEFAULT_PH_VERSION);

// Major mismatch throws (halts startup); minor/patch drift warns.
function checkPhCompatible(versionOutput: string, log: Logger): void {
  const cur = parseVersion(versionOutput);
  if (!EXPECTED_PH || !cur) {
    log.warn(
      `[ensure-ph] could not parse ph version (built against ${DEFAULT_PH_VERSION}); skipping compatibility check`,
    );
    return;
  }
  const fix = `install a matching ph-cmd: \`pnpm add -g ph-cmd@${DEFAULT_PH_VERSION}\``;
  if (cur.major !== EXPECTED_PH.major) {
    throw new Error(
      `[ensure-ph] incompatible ph ${cur.version}: vetra-cli requires ph ${EXPECTED_PH.major}.x (built against ${DEFAULT_PH_VERSION}). To fix, ${fix}.`,
    );
  }
  if (cur.minor !== EXPECTED_PH.minor || cur.patch !== EXPECTED_PH.patch) {
    log.warn(
      `[ensure-ph] ph ${cur.version} differs from the built-against ${DEFAULT_PH_VERSION}; proceeding — if you hit issues, ${fix}`,
    );
    return;
  }
  log.debug(`[ensure-ph] ph ${cur.version} matches the built-against version`);
}

export function ensurePh(): LifecycleHook {
  return {
    name: "ensure-ph",
    async onInit(ctx) {
      const log: Logger = ctx.log;

      const present = await phVersionOutput();
      if (present !== null) {
        log.debug("[ensure-ph] ph already on PATH; checking compatibility");
        checkPhCompatible(present, log);
        return {};
      }

      const registry = process.env.CLINT_REGISTRY;
      const spec = `ph-cmd@${DEFAULT_PH_VERSION}`;
      const regArgs = registry ? ["--registry", registry] : [];
      // Prefer pnpm; fall back to npm when pnpm isn't on PATH.
      let pm = "pnpm";
      let args = ["add", "-g", spec, ...regArgs];
      if (!(await run("pnpm", ["--version"], CHECK_TIMEOUT_MS)).success) {
        pm = "npm";
        args = ["install", "-g", spec, ...regArgs];
      }
      log.info(
        `[ensure-ph] ph not found; installing ${spec}` +
          (registry ? ` from ${registry}` : "") +
          ` (${pm} ${args.join(" ")})`,
      );

      const { success, output } = await run(pm, args, INSTALL_TIMEOUT_MS);
      if (!success) {
        throw new Error(
          `[ensure-ph] failed to install ${spec}: ${output.trim()}`,
        );
      }

      if ((await phVersionOutput()) === null) {
        throw new Error(
          `[ensure-ph] installed ${spec} but \`ph\` still does not resolve on PATH`,
        );
      }
      log.info(`[ensure-ph] installed ${spec}; ph now resolves`);
      return {};
    },
  };
}
