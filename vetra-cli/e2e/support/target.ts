import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** vetra-cli/e2e */
export const E2E_DIR = path.resolve(here, "..");
/** vetra-cli (where `tsx src/main.ts` is run from) */
export const CLI_DIR = path.resolve(E2E_DIR, "..");
export const CACHE_DIR = path.join(E2E_DIR, ".cache");
/** Written by global-setup once the studio boots: where to point the test. */
export const RUN_FILE = path.join(CACHE_DIR, "run.json");
/** Full studio stdout/stderr; the spec tails it to fail fast on a replay error
 * rather than waiting out the preview timeout. */
export const STUDIO_LOG = path.join(CACHE_DIR, "studio.log");

/** Per-run ph-home under the disposable workdir. The studio boots with HOME
 * here so service state (rooted at homedir()/.ph/<cli>) stays in the tmp tree. */
export function phHomeFor(workdir: string): string {
  return path.join(workdir, "home");
}

/** A seeded run: the prompt that kicks off the build, the recorded tool
 * sequence the replay agent executes, and the editor state the BUILD pane
 * should end up showing. One fixture == one reproducible build. */
export interface StudioFixture {
  name: string;
  /** Typed into the chat to start the agent (replay ignores its content). */
  prompt: string;
  /** Replay fixture filename under e2e/fixtures/ (tool steps). */
  replay: string;
  /** What the BUILD-pane preview iframe should render once the build lands. */
  preview: {
    project: string;
    documentName: string;
    items: { text: string; completed: boolean }[];
  };
}

export function loadFixture(): StudioFixture {
  const name = process.env.VETRA_FIXTURE ?? "todo-list";
  const file = path.join(E2E_DIR, "fixtures", `${name}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as StudioFixture;
}

/** Absolute path to the replay fixture — passed to the CLI as
 * VETRA_REPLAY_FIXTURE by global-setup. */
export function replayFixturePath(fx: StudioFixture): string {
  return path.join(E2E_DIR, "fixtures", fx.replay);
}

/** Where the studio is + which drive to open. Resolved by global-setup
 * (boot) or via env when attaching to a manually-started replay studio. */
export interface RunTarget {
  baseUrl: string;
  driveId: string;
}

export function loadRun(): RunTarget {
  if (process.env.VETRA_BASE_URL && process.env.VETRA_DRIVE_ID) {
    return {
      baseUrl: process.env.VETRA_BASE_URL.replace(/\/$/, ""),
      driveId: process.env.VETRA_DRIVE_ID,
    };
  }
  return JSON.parse(readFileSync(RUN_FILE, "utf8")) as RunTarget;
}
