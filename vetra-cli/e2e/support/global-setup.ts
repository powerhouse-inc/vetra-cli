import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import {
  CACHE_DIR,
  CLI_DIR,
  RUN_FILE,
  STUDIO_LOG,
  loadFixture,
  phHomeFor,
  replayFixturePath,
} from "./target.js";

/** studioUrlTrigger prints this once the embedded studio is reachable. */
const STUDIO_LINE = /Vetra Studio:\s*(http:\/\/\S+)/;
const BOOT_TIMEOUT_MS = 180_000;

/** Studio boot command: default runs from source via tsx;
 * VETRA_E2E_BOOT_CMD=vetra boots the globally-installed `vetra` bin. */
function bootSpec(workdir: string): {
  command: string;
  args: string[];
  cwd?: string;
} {
  if (process.env.VETRA_E2E_BOOT_CMD === "vetra") {
    return { command: "vetra", args: ["--workdir", workdir] };
  }
  return {
    command: "pnpm",
    args: ["exec", "tsx", "src/main.ts", "--workdir", workdir],
    cwd: CLI_DIR,
  };
}

/** Boot a self-contained REPLAY studio (isolated HOME, auto-assigned ports) and
 * record baseUrl + driveId in RUN_FILE; VETRA_E2E_BASE_URL attaches instead. */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });

  if (process.env.VETRA_E2E_BASE_URL) {
    const baseUrl = process.env.VETRA_E2E_BASE_URL.replace(/\/$/, "");
    const driveId = await discoverDriveId(baseUrl);
    writeFileSync(
      RUN_FILE,
      JSON.stringify({ baseUrl, driveId, pid: null, workdir: null }, null, 2),
    );
    return;
  }

  const fixture = loadFixture();
  const workdir = mkdtempSync(path.join(os.tmpdir(), "vetra-e2e-"));
  // ph-clint roots service state at HOME/.ph/<cli>; point HOME into the
  // throwaway tree so the run never touches the developer's real ~/.ph.
  const phHome = phHomeFor(workdir);
  mkdirSync(phHome, { recursive: true });
  const boot = bootSpec(workdir);
  const child = spawn(boot.command, boot.args, {
    cwd: boot.cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: phHome,
      // Under CI, picocolors/Vite colorize even non-TTY, and the inner
      // `ph vetra` readiness pattern can't match the ANSI-wrapped `Local:` line.
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      // Keep the pnpm store (content-addressed, concurrency-safe) shared so
      // the inner `ph init` install stays warm despite the isolated HOME.
      npm_config_store_dir:
        process.env.npm_config_store_dir ??
        path.join(os.tmpdir(), "vetra-e2e-pnpm-store"),
      // Auto-assign the proxy port so parallel runs don't collide on 8090; the
      // resolved URL is parsed from the boot log below.
      VETRA_PROXY_PORT: "0",
      // Cold `ph vetra` Vite start is slow on constrained CI runners; give the
      // reactor-project readiness check generous headroom.
      VETRA_REACTOR_READINESS_TIMEOUT_MS:
        process.env.VETRA_REACTOR_READINESS_TIMEOUT_MS ?? "240000",
      VETRA_REPLAY_FIXTURE: replayFixturePath(fixture),
      // A placeholder is enough — replay never calls the model.
      VETRA_ANTHROPIC_API_KEY:
        process.env.VETRA_ANTHROPIC_API_KEY ?? "sk-ant-placeholder",
      SERVICE_COMMAND: process.env.SERVICE_COMMAND ?? "vetra",
    },
  });
  // Tee everything to a file for the whole run (persists past the URL match).
  const logStream = createWriteStream(STUDIO_LOG);
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  let studioUrl: string;
  try {
    studioUrl = await waitForStudio(child);
  } catch (err) {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    throw err;
  }

  const url = new URL(studioUrl);
  const driveId = url.pathname.match(/\/d\/([^/?#]+)/)?.[1];
  if (!driveId) throw new Error(`Could not parse drive id from "${studioUrl}"`);

  writeFileSync(
    RUN_FILE,
    JSON.stringify(
      { baseUrl: url.origin, driveId, pid: child.pid, workdir },
      null,
      2,
    ),
  );
  // Let the studio outlive globalSetup; global-teardown kills the group.
  child.unref();
}

function waitForStudio(child: ChildProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    let settled = false;
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      buf += text;
      // Mirror boot output so a hang is debuggable in the Playwright log.
      process.stdout.write(text);
      const m = buf.match(STUDIO_LINE);
      if (m && !settled) {
        settled = true;
        cleanup();
        resolve(m[1].trim());
      }
    };
    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `vetra-cli exited (code ${code}) before the studio was ready. ` +
            `Check the boot log above — common causes: port 8090 already in ` +
            `use (stop any running \`vetra\` studio), or a codegen/install failure.`,
        ),
      );
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error(`Studio not ready within ${BOOT_TIMEOUT_MS}ms`));
    }, BOOT_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    }
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", onExit);
  });
}

async function discoverDriveId(baseUrl: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new Error(
      `Could not reach VETRA_E2E_BASE_URL ${baseUrl} ` +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        `Is a vetra studio running there in replay mode?`,
    );
  }
  const loc = res.headers.get("location") ?? "";
  const id = loc.match(/\/d\/([^/?#]+)/)?.[1];
  if (!id) {
    throw new Error(
      `${baseUrl}/ did not redirect to /d/<driveId> (got ${res.status} ${loc}). ` +
        `Is a vetra studio running there in replay mode?`,
    );
  }
  return id;
}
