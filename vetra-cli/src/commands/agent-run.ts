import { z } from "zod";
import { defineCommand } from "../framework.js";

/**
 * Drive the Vetra agent with a single prompt and emit each stream chunk
 * as one NDJSON line on stdout. Intended for the agent-eval test harness
 * and for scripting the agent outside the studio UI.
 *
 * Output framing: every line is a JSON object with a `type` discriminator.
 * The set of types matches `StreamChunk` from ph-clint:
 *   text-delta, tool-call, tool-output, tool-result, error
 * Plus two harness-level lines:
 *   { "type": "start", "prompt": "..." }
 *   { "type": "end", "elapsedMs": 12345 }
 */
export const agentRun = defineCommand({
  id: "vetra-agent-run",
  description:
    "Drive the Vetra agent with a single prompt and emit each stream chunk as NDJSON to stdout.",
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .describe("The prompt to send to the agent."),
    threadId: z
      .string()
      .optional()
      .describe("Optional Mastra threadId for memory persistence."),
    maxWallMs: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Hard wall-clock budget (ms) for the entire stream. The underlying LLM request is aborted when exceeded.",
      ),
  }),
  execute: async ({ prompt, threadId, maxWallMs }, ctx) => {
    if (!ctx.agent) {
      throw new Error(
        "Agent not configured. The CLI must be built with an agent factory (ANTHROPIC_API_KEY required).",
      );
    }
    const agent = await ctx.agent();
    if (!agent) {
      throw new Error("Agent factory returned undefined (likely missing API key).");
    }

    const start = Date.now();
    const abortController = new AbortController();
    let timedOut = false;
    const wallTimer = maxWallMs
      ? setTimeout(() => {
          timedOut = true;
          process.stdout.write(
            JSON.stringify({
              type: "error",
              error: `wall-clock budget exceeded (${maxWallMs}ms) — aborting stream`,
            }) + "\n",
          );
          abortController.abort();
        }, maxWallMs)
      : null;
    /* Write each chunk straight to stdout as its own JSON line. We bypass
     * the command's normal return-text path because the consumer needs a
     * progressive stream, not a single final blob. */
    process.stdout.write(
      JSON.stringify({ type: "start", prompt, maxWallMs }) + "\n",
    );
    let chunkCount = 0;
    try {
      for await (const chunk of agent.stream(prompt, {
        ...(threadId ? { threadId } : {}),
        abortSignal: abortController.signal,
      })) {
        process.stdout.write(JSON.stringify(chunk) + "\n");
        chunkCount++;
      }
    } catch (err) {
      process.stdout.write(
        JSON.stringify({
          type: "error",
          error: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
    } finally {
      if (wallTimer) clearTimeout(wallTimer);
    }
    process.stdout.write(
      JSON.stringify({
        type: "end",
        elapsedMs: Date.now() - start,
        chunkCount,
        timedOut,
      }) + "\n",
    );

    /* Force-exit. agent-run is a one-shot CLI invocation, but the framework
     * spins up services (reactor-project, triggers, etc.) that keep the
     * event loop alive long after the stream returns. Without this, a
     * caller spawning the CLI to capture the NDJSON stream waits until
     * something external kills the process. We flush stdout/stderr first to
     * make sure the final `end` line and any logger output reach the pipe. */
    const summary = `Stream completed: ${chunkCount} chunk(s) in ${Date.now() - start}ms${timedOut ? " (timed out)" : ""}`;
    process.stderr.write(summary + "\n");
    await Promise.all([
      new Promise<void>((r) => process.stdout.write("", () => r())),
      new Promise<void>((r) => process.stderr.write("", () => r())),
    ]);
    process.exit(0);
  },
});
