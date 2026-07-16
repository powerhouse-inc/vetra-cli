import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryWorkdirStore } from "@powerhousedao/ph-clint";

/**
 * Make a fresh temp workdir for one test, and a cleanup function. The dir is
 * stubbed with a `powerhouse.config.json` so spec commands pass the
 * `resolveReactorProjectPath` precondition.
 */
export function makeWorkdir(): { workdir: string; cleanup: () => void } {
  const workdir = mkdtempSync(join(tmpdir(), "vetra-test-"));
  writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
  return {
    workdir,
    cleanup: () => rmSync(workdir, { recursive: true, force: true }),
  };
}

/** Minimal CommandContext matching what our spec-* commands actually use. */
export function makeCtx(workdir: string) {
  return {
    workdir,
    workspace: createMemoryWorkdirStore(),
    stdout: () => {},
    config: {},
  };
}
