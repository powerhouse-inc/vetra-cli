/**
 * SMOKE check (Ruling E8): the preview renders without errors, judged
 * server-side so it also works with the browser closed.
 *
 * Passes when `ph build` of the package succeeds AND the project's preview
 * (the reactor project's Vite dev server) answers 200 without an error-overlay
 * payload for every source module of each editor and app. Vite transforms a
 * module only when it is requested, so each module file is requested.
 */
import fs from "node:fs";
import path from "node:path";
import { runBuild } from "../commands/reactor-project/build.js";
import { capReason, type ObservedCheck } from "./check-results.js";

export type CheckResult = ObservedCheck;

export interface SmokeDeps {
  /** The preview's base URL (the project's Connect dev server), if running. */
  previewUrl?: string;
  build?: (projectPath: string) => Promise<{ success: boolean; output: string }>;
  fetch?: typeof fetch;
}

const MODULE_ROOTS = ["editors", "apps"];
const FETCH_TIMEOUT_MS = 30_000;
/* Vite answers a failed transform with its error page (500), whose script
 * hands the error to the overlay; some setups serve it with 200. */
const OVERLAY = /ErrorOverlay|vite-error-overlay|\[vite\] Internal server error/;

function listModules(projectPath: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$|\.(test|spec)\.tsx?$/.test(entry.name)) {
        out.push(path.relative(projectPath, abs).split(path.sep).join("/"));
      }
    }
  };
  for (const root of MODULE_ROOTS) {
    const dir = path.join(projectPath, root);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out.sort();
}

/** First line of the error Vite reports, else the HTTP status. */
function describeFailure(status: number, body: string): string {
  const m = /"message":\s*"((?:[^"\\]|\\.)*)"/.exec(body);
  if (m) {
    try {
      return (JSON.parse(`"${m[1]}"`) as string).split("\n")[0];
    } catch {
      return m[1].split("\\n")[0];
    }
  }
  return `HTTP ${status}`;
}

function fail(reason: string): CheckResult {
  return { kind: "SMOKE", passed: false, reason: capReason(reason) };
}

export async function runSmoke(projectPath: string, deps: SmokeDeps = {}): Promise<CheckResult> {
  const build = deps.build ?? ((p: string) => runBuild(p));
  const built = await build(projectPath);
  if (!built.success) {
    const tail = built.output.trim().split("\n").slice(-5).join("\n");
    return fail(`The package build failed: ${tail || "(no output)"}`);
  }

  const modules = listModules(projectPath);
  if (modules.length === 0) {
    return { kind: "SMOKE", passed: true, reason: "No editor or app modules to check." };
  }
  if (!deps.previewUrl) {
    return fail("The preview is not running (start it with reactor-project-start), so the editors could not be checked.");
  }

  const doFetch = deps.fetch ?? fetch;
  const base = deps.previewUrl.endsWith("/") ? deps.previewUrl : `${deps.previewUrl}/`;
  const failures: string[] = [];
  for (const rel of modules) {
    try {
      const res = await doFetch(new URL(rel, base), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const body = await res.text();
      if (res.status !== 200 || OVERLAY.test(body)) {
        failures.push(`${rel}: ${describeFailure(res.status, body)}`);
      }
    } catch (err) {
      failures.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (failures.length >= 3) break;
  }
  if (failures.length > 0) return fail(`The preview could not load ${failures.join("; ")}`);
  return { kind: "SMOKE", passed: true, reason: null };
}
