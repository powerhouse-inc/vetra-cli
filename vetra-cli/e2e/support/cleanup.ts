import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Copy the run's service logs (incl. the inner `ph vetra`) out of the isolated
 * ph-home into `dest` before the workdir is removed, so they reach CI artifacts. */
export function collectServiceLogs(phHome: string, dest: string): void {
  const root = path.join(phHome, ".ph");
  if (!existsSync(root)) return;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".log")) {
        mkdirSync(dest, { recursive: true });
        // Flatten + strip characters CI artifact upload rejects (e.g. ':').
        const rel = path.relative(root, full).replace(/[/\\:<>"|*?\r\n]/g, "_");
        try {
          copyFileSync(full, path.join(dest, rel));
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(root);
}

/** Kill `pid` and its process group (ph-clint detaches each service into its
 * own group, so the negative-pid kill catches nested children too). */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

/** Recursively collect service-instance pids from <phHome>/.ph/<cli>/services. */
function serviceStatePids(phHome: string): number[] {
  const root = path.join(phHome, ".ph");
  if (!existsSync(root)) return [];
  const pids: number[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json")) {
        try {
          const state = JSON.parse(readFileSync(full, "utf8")) as {
            pid?: number;
            status?: string;
          };
          // Service-instance files carry a status; ignore config/other json.
          if (Number.isInteger(state.pid) && typeof state.status === "string") {
            pids.push(state.pid!);
          }
        } catch {
          /* unreadable/foreign */
        }
      }
    }
  };
  walk(root);
  return pids;
}

/** Kill every service this run started, scoped to its isolated ph-home — so
 * teardown never touches a parallel worktree's studio. */
export async function killRunServices(phHome: string): Promise<void> {
  const pids = serviceStatePids(phHome);
  for (const pid of pids) killGroup(pid, "SIGTERM");
  await wait(500);
  for (const pid of pids) killGroup(pid, "SIGKILL");
}
