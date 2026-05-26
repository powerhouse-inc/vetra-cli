/**
 * Live LLM eval for the "build a workout tracker" prompt.
 *
 * Drives the real Vetra agent against an isolated temp workdir, captures
 * tool-call events, and runs the assertion library from `assertions.ts`
 * against the resulting transcript. This costs real Anthropic tokens
 * (~$0.50–$2 per run) and takes ~10–15 minutes including
 * `reactor-project-init`, so it's double-gated:
 *
 *   ANTHROPIC_API_KEY=...    # must be set
 *   RUN_AGENT_EVALS=1        # explicit opt-in
 *
 * Without both, the suite is skipped — including in normal CI runs.
 *
 * --------------------------------------------------------------------
 * IMPLEMENTATION STATUS
 * --------------------------------------------------------------------
 *
 * The harness shape is in place. The live driver (`driveAgent`) is
 * deliberately unimplemented — wiring it up needs an architectural
 * decision documented in TODO:
 *
 *   - Option A: add an internal `vetra-agent-run --prompt <text>` CLI
 *     command that wraps `agentProvider.stream(prompt)` and emits
 *     NDJSON tool events. The test then spawns the CLI like the
 *     existing `cli-e2e.test.ts` does, parses NDJSON, runs assertions.
 *
 *   - Option B: build `AgentSetupContext` in-process (mirroring
 *     `src/cli.ts`) and call `createAgent(ctx).stream(prompt)`
 *     directly. No subprocess but the ctx wiring (services, triggers,
 *     workspace, memory) is non-trivial.
 *
 * Option A is the cheaper first step. Until it lands, this file
 * exists to (a) lock in the assertion contract for live runs and (b)
 * fail loudly with a clear next-step if someone flips the env vars
 * before the driver exists.
 */
import { describe, it, expect } from "@jest/globals";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fsAsync from "node:fs/promises";
import {
  allOperationNamesCanonical,
  boundedToolCalls,
  finalCheckClean,
  neverEditedGenFiles,
  noReleaseBeforeModules,
  respondsToDiagnostics,
  type AssertionResult,
} from "./assertions.js";
import {
  addUsage,
  computeCost,
  emptyUsage,
  formatCostLine,
  type UsageTotals,
} from "./cost.js";
import type { AgentEvent } from "./events.js";

/* Must match the model id wired into `src/agents/agent.ts`. The eval logs
 * the resolved cost using LiteLLM's price table; if you change the agent
 * model, update this constant (or thread the id through agent-run output). */
const EVAL_MODEL_ID = "anthropic/claude-sonnet-4-5";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "main.ts");
const TSX = join(__dirname, "..", "..", "node_modules", ".bin", "tsx");

const optedIn = process.env.RUN_AGENT_EVALS === "1";
const describeIfEnabled = optedIn ? describe : describe.skip;

/** Cap a live run at 10 minutes. */
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Hard wall-clock budget passed to the subprocess. The subprocess aborts
 *  its own LLM stream when this elapses, so the test isn't relying solely
 *  on the outer jest timeout. Slightly less than RUN_TIMEOUT_MS so the
 *  child has time to flush. */
const SUBPROCESS_WALL_MS = 9 * 60 * 1000;

/** Kill the subprocess if no *progress* chunk arrives within this window.
 *  "Progress" means a tool-call or tool-result — text-deltas from the
 *  retry loop don't count, since we saw the agent emit text-delta chatter
 *  for 15 minutes while looping on a transient ECONNRESET. */
const SILENCE_KILL_MS = 60_000;
const PROGRESS_CHUNK_TYPES = new Set(["tool-call", "tool-result"]);

/** Tool-call budget — exceeding this means the agent went off the rails. */
const MAX_TOOL_CALLS = 60;

describeIfEnabled("live agent eval: workout tracker", () => {
  it(
    "builds a workout tracker without hitting known foot-guns",
    async () => {
      const workdir = mkdtempSync(join(tmpdir(), "vetra-eval-"));
      writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
      const keepWorkdir = process.env.KEEP_AGENT_EVAL_WORKDIR === "1";
      // eslint-disable-next-line no-console
      console.log(`[agent-eval] workdir: ${workdir}`);
      try {
        const { events, usage } = await driveAgent({
          workdir,
          prompt: "Build a workout tracker",
        });

        try {
          const cost = await computeCost(EVAL_MODEL_ID, usage);
          // eslint-disable-next-line no-console
          console.log(`[agent-eval] ${formatCostLine(usage, cost)}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[agent-eval] cost lookup failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        const streamErrors = events
          .filter(
            (e) =>
              e.kind === "tool_result" &&
              e.tool === "<stream-error>" &&
              e.error,
          )
          .map((e) => (e as { error: { message: string } }).error.message);
        if (streamErrors.length > 0) {
          // eslint-disable-next-line no-console
          console.error(
            `[agent-eval] stream errors during run:\n${streamErrors.map((m) => `  - ${m}`).join("\n")}`,
          );
        }

        const results: Record<string, AssertionResult> = {
          neverEditedGenFiles: neverEditedGenFiles(events),
          noReleaseBeforeModules: noReleaseBeforeModules(events),
          allOperationNamesCanonical: allOperationNamesCanonical(events),
          respondsToDiagnostics: respondsToDiagnostics(events),
          finalCheckClean: finalCheckClean(events),
          boundedToolCalls: boundedToolCalls(events, MAX_TOOL_CALLS),
        };

        const failed = Object.entries(results).filter(([, r]) => !r.passed);
        if (failed.length > 0 || streamErrors.length > 0) {
          const errSection = streamErrors.length
            ? `Stream errors:\n${streamErrors.map((m) => `  - ${m}`).join("\n")}\n\n`
            : "";
          const report = failed
            .map(
              ([name, r]) =>
                `- ${name}:\n${r.violations
                  .map((v) => `    [index ${v.index}] ${v.message}`)
                  .join("\n")}`,
            )
            .join("\n");
          throw new Error(
            `Agent eval: ${failed.length} assertion(s) failed, ${streamErrors.length} stream error(s).\n${errSection}${report}`,
          );
        }
        expect(failed).toHaveLength(0);
      } finally {
        if (!keepWorkdir) {
          rmSync(workdir, { recursive: true, force: true });
        } else {
          // eslint-disable-next-line no-console
          console.log(`[agent-eval] preserved workdir: ${workdir}`);
        }
      }
    },
    RUN_TIMEOUT_MS,
  );
});

/**
 * Drive a real Vetra agent by spawning `vetra-agent-run` and converting
 * the resulting NDJSON stream chunks into `AgentEvent[]` so the same
 * assertions used in `replay.test.ts` apply here. Tool-call/result
 * pairs are matched by `toolCallId`. Token usage is summed across
 * `step-finish` chunks, falling back to the final `finish` chunk if
 * it carries an authoritative total (preferred when present).
 */
async function driveAgent(opts: {
  workdir: string;
  prompt: string;
}): Promise<{ events: AgentEvent[]; usage: UsageTotals }> {
  const chunks = await spawnAgentRun(opts.workdir, opts.prompt);
  return {
    events: chunksToEvents(chunks),
    usage: aggregateUsage(chunks),
  };
}

function aggregateUsage(chunks: RawChunk[]): UsageTotals {
  /* Each Mastra `step-finish` carries one LLM turn's usage; the `finish`
   * chunk only mirrors the last step's numbers (no aggregated total in
   * this Mastra version), so we sum step-finishes and ignore `finish`. */
  const totals = emptyUsage();
  for (const chunk of chunks) {
    if (chunk.type === "step-finish" && chunk.usage) {
      addUsage(totals, chunk.usage as Partial<UsageTotals>);
    }
  }
  return totals;
}

interface RawChunk {
  type: string;
  [key: string]: unknown;
}

function spawnAgentRun(workdir: string, prompt: string): Promise<RawChunk[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      TSX,
      [
        CLI_PATH,
        "-w",
        workdir,
        "vetra-agent-run",
        "--prompt",
        prompt,
        "--maxWallMs",
        String(SUBPROCESS_WALL_MS),
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
    );
    let stdout = "";
    let stderr = "";
    let pendingLine = "";
    let lastProgressAt = Date.now();
    let progressChunks = 0;
    let killedForSilence = false;
    const errors: string[] = [];

    function ingestChunk(line: string): void {
      let chunk: RawChunk | null = null;
      try {
        chunk = JSON.parse(line) as RawChunk;
      } catch {
        return;
      }
      if (!chunk?.type) return;
      if (PROGRESS_CHUNK_TYPES.has(chunk.type)) {
        progressChunks++;
        lastProgressAt = Date.now();
        const toolName = String(chunk.toolName ?? "?");
        process.stderr.write(
          `[agent-eval] ${chunk.type} ${toolName} (#${progressChunks})\n`,
        );
      } else if (chunk.type === "error") {
        const msg = String(chunk.error ?? "?");
        errors.push(msg);
        process.stderr.write(`[agent-eval] stream error: ${msg}\n`);
      } else if (chunk.type === "end") {
        process.stderr.write(
          `[agent-eval] subprocess end: elapsed=${chunk.elapsedMs}ms timedOut=${chunk.timedOut}\n`,
        );
      }
    }

    /* Heartbeat: silence is measured against progress chunks only, so
     * text-delta chatter during a retry loop won't keep the killer at bay. */
    const heartbeat = setInterval(() => {
      const elapsed = Date.now() - lastProgressAt;
      process.stderr.write(
        `[agent-eval] alive: progress=${progressChunks} last-progress=${(elapsed / 1000).toFixed(0)}s ago\n`,
      );
      if (elapsed > SILENCE_KILL_MS) {
        killedForSilence = true;
        process.stderr.write(
          `[agent-eval] no progress for ${SILENCE_KILL_MS / 1000}s — killing subprocess\n`,
        );
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      }
    }, 30_000);

    child.stdout.on("data", (d: Buffer) => {
      const text = d.toString();
      stdout += text;
      pendingLine += text;
      let nl = pendingLine.indexOf("\n");
      while (nl !== -1) {
        const line = pendingLine.slice(0, nl).trim();
        pendingLine = pendingLine.slice(nl + 1);
        if (line) ingestChunk(line);
        nl = pendingLine.indexOf("\n");
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearInterval(heartbeat);
      reject(err);
    });
    child.on("close", async (code) => {
      clearInterval(heartbeat);
      // Persist the raw transcript next to the workdir for post-mortem,
      // regardless of pass/fail. Helps when the run blows past the budget.
      // Uses fs/promises so the ESM module loads cleanly — the earlier
      // `require("node:fs")` here threw silently and dropped artifacts.
      try {
        await fsAsync.writeFile(
          join(workdir, "agent-run.stdout.ndjson"),
          stdout,
        );
        await fsAsync.writeFile(
          join(workdir, "agent-run.stderr.log"),
          stderr,
        );
        process.stderr.write(
          `[agent-eval] raw transcript saved to ${workdir}/agent-run.stdout.ndjson (${stdout.length}B stdout, ${stderr.length}B stderr)\n`,
        );
      } catch (err) {
        process.stderr.write(
          `[agent-eval] failed to save transcript: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
      if (code !== 0 && code !== null && !killedForSilence) {
        reject(
          new Error(
            `vetra-agent-run exited with code ${code}. stderr tail:\n${stderr.slice(-2000)}`,
          ),
        );
        return;
      }
      const chunks: RawChunk[] = [];
      for (const raw of stdout.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        try {
          chunks.push(JSON.parse(line) as RawChunk);
        } catch {
          // Non-JSON line (probably ph-clint progress text leaking through)
          // — ignore. Tool-call/result lines are well-formed JSON.
        }
      }
      resolve(chunks);
    });
  });
}

function chunksToEvents(chunks: RawChunk[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  let index = 0;
  for (const chunk of chunks) {
    const next = () => {
      index++;
      return { index, line: index };
    };
    switch (chunk.type) {
      case "text-delta": {
        // Coalesce adjacent text-deltas into one assistant_message event.
        const prev = events[events.length - 1];
        if (prev && prev.kind === "assistant_message") {
          (prev as { content: string }).content += String(chunk.text ?? "");
        } else {
          const { index, line } = next();
          events.push({
            kind: "assistant_message",
            index,
            line,
            content: String(chunk.text ?? ""),
          });
        }
        break;
      }
      case "tool-call": {
        const { index, line } = next();
        events.push({
          kind: "tool_use",
          index,
          line,
          tool: String(chunk.toolName),
          callId: chunk.toolCallId ? String(chunk.toolCallId) : undefined,
          input: chunk.args,
        });
        break;
      }
      case "tool-result": {
        const { index, line } = next();
        events.push({
          kind: "tool_result",
          index,
          line,
          tool: String(chunk.toolName),
          callId: chunk.toolCallId ? String(chunk.toolCallId) : undefined,
          output: chunk.result,
          error: chunk.isError
            ? { message: String((chunk.result as Record<string, unknown>)?.message ?? "tool error") }
            : undefined,
        });
        break;
      }
      case "error": {
        const { index, line } = next();
        events.push({
          kind: "tool_result",
          index,
          line,
          tool: "<stream-error>",
          output: undefined,
          error: { message: String(chunk.error ?? "unknown error") },
        });
        break;
      }
      // start / end / tool-output — informational only, skip.
      default:
        break;
    }
  }
  return events;
}
