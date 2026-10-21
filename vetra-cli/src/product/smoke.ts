/**
 * SMOKE check (Ruling E8): the preview renders without errors, judged
 * server-side so it also works with the browser closed.
 *
 * Passes when `ph build` of the package succeeds AND the project's preview
 * (the reactor project's Vite dev server) answers 200 without an error-overlay
 * payload for every source module of each editor and app. Vite transforms a
 * module only when it is requested, so each module file is requested.
 *
 * The example documents (`seed/*.json`, D21) are part of SMOKE too: every one
 * must fit the project's document models, and — when the workspace has a
 * product document — a project with document types needs at least one
 * (`seedCheck`, launch/seed.ts). The screens are checked either way.
 */
import fs from "node:fs";
import path from "node:path";
import { runBuild } from "../commands/reactor-project/build.js";
import { capReason, type ObservedCheck } from "./check-results.js";
import { seedCheck } from "../launch/seed.js";

export type CheckResult = ObservedCheck;

export interface SmokeDeps {
  /** The preview's base URL (the project's Connect dev server), if running. */
  previewUrl?: string;
  build?: (projectPath: string) => Promise<{ success: boolean; output: string }>;
  fetch?: typeof fetch;
  /**
   * Example documents are required (Ruling X27: when the workspace has a
   * product document). Otherwise missing examples only add a note.
   */
  requireExamples?: boolean;
  /** Receives notes for the tool output (e.g. no example documents yet). */
  notes?: string[];
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

/* `reason` is stored and shown to the customer; `detail` is for the agent. */
function fail(reason: string, detail: string, base: string): CheckResult {
  return { kind: "SMOKE", passed: false, reason: capReason(reason, { base }), detail };
}

export async function runSmoke(projectPath: string, deps: SmokeDeps = {}): Promise<CheckResult> {
  const build = deps.build ?? ((p: string) => runBuild(p));
  const built = await build(projectPath);
  if (!built.success) {
    const tail = built.output.trim().split("\n").slice(-5).join("\n");
    return fail("The app didn't build.", `ph build failed: ${tail || "(no output)"}`, projectPath);
  }

  const screens = await checkScreens(projectPath, deps);
  const seeds = seedCheck(projectPath, { requireExamples: deps.requireExamples === true });
  if (seeds.note) deps.notes?.push(seeds.note);
  if (!seeds.check) return screens;
  // A screen that doesn't load is the bigger problem: report it first, with the examples' detail.
  if (!screens.passed) {
    return { ...screens, detail: `${screens.detail ?? ""} Also: ${seeds.check.detail ?? seeds.check.reason ?? ""}`.trim() };
  }
  return seeds.check;
}

/** Every editor/app module loads in the running preview. */
async function checkScreens(projectPath: string, deps: SmokeDeps): Promise<CheckResult> {
  const modules = listModules(projectPath);
  if (modules.length === 0) {
    return { kind: "SMOKE", passed: true, reason: "There are no screens to check." };
  }
  if (!deps.previewUrl) {
    return fail(
      "The preview isn't running, so the screens couldn't be checked.",
      "The preview is not running; start it with reactor-project-start, then check again.",
      projectPath,
    );
  }

  const doFetch = deps.fetch ?? fetch;
  const base = deps.previewUrl.endsWith("/") ? deps.previewUrl : `${deps.previewUrl}/`;
  const failures: Array<{ rel: string; why: string }> = [];
  for (const rel of modules) {
    try {
      const res = await doFetch(new URL(rel, base), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const body = await res.text();
      if (res.status !== 200 || OVERLAY.test(body)) {
        failures.push({ rel, why: describeFailure(res.status, body) });
      }
    } catch (err) {
      failures.push({ rel, why: err instanceof Error ? err.message : String(err) });
    }
    if (failures.length >= 3) break;
  }
  if (failures.length > 0) {
    const files = failures.map((f) => f.rel).join(", ");
    return fail(
      failures.length === 1 ? `A screen didn't load: ${files}.` : `Some screens didn't load: ${files}.`,
      `The preview could not load: ${failures.map((f) => `${f.rel}: ${f.why}`).join("; ")}`,
      projectPath,
    );
  }
  return { kind: "SMOKE", passed: true, reason: null };
}
