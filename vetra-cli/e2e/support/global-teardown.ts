import path from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { collectServiceLogs, killRunServices } from "./cleanup.js";
import { CACHE_DIR, RUN_FILE, phHomeFor } from "./target.js";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stop the booted studio: SIGINT the main pid for graceful ServiceManager
 * shutdown, then scoped-kill leftover services from its isolated ph-home. */
export default async function globalTeardown(): Promise<void> {
  let run: { pid: number | null; workdir: string | null };
  try {
    run = JSON.parse(readFileSync(RUN_FILE, "utf8"));
  } catch {
    return;
  }

  if (run.pid) {
    // SIGINT the main pid (not the group) so its shutdown handler runs and
    // stops each service's own process group.
    try {
      process.kill(run.pid, "SIGINT");
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 30 && alive(run.pid); i++) await wait(500); // up to 15s
    if (alive(run.pid)) {
      try {
        process.kill(-run.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }

  // Scoped backstop: kill leftover services recorded under this run's ph-home.
  if (run.workdir) await killRunServices(phHomeFor(run.workdir));

  // Save service logs (incl. the inner `ph vetra`) before removing the workdir.
  if (run.workdir) {
    collectServiceLogs(phHomeFor(run.workdir), path.join(CACHE_DIR, "service-logs"));
  }

  if (run.workdir) {
    if (process.env.VETRA_E2E_KEEP_WORKDIR) {
      console.log(`[e2e] kept workdir for inspection: ${run.workdir}`);
    } else {
      rmSync(run.workdir, { recursive: true, force: true });
    }
  }
}
