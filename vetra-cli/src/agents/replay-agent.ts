import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentProvider,
  AgentSetupContext,
  StreamChunk,
} from '@powerhousedao/ph-clint';
import type { Config } from '../framework.js';

/**
 * Replay agent — deterministic e2e driver. Instead of calling an LLM, it
 * replays a recorded sequence of tool calls (see
 * `e2e/fixtures/*.replay.json`), executing the REAL commands against the live
 * reactor. Only tool *selection* is canned; every reactor mutation, file
 * write, codegen run and project start happens for real, so the studio renders
 * a genuinely-built result. Gated by `VETRA_REPLAY_FIXTURE`; see
 * `createAgent`.
 */
interface ReplayStep {
  tool: string;
  args: Record<string, unknown>;
}
interface ReplayFixture {
  steps: ReplayStep[];
  /** Assistant text emitted once the replay completes. */
  done?: string;
}

/** Workspace file tools aren't ph-clint commands (Mastra provides them on the
 * agent's workspace), so the replay performs the equivalent fs write/read
 * directly — the chokidar watcher + Vite HMR react to it identically. */
const WORKSPACE_WRITE = 'mastra_workspace_write_file';
const WORKSPACE_READ = 'mastra_workspace_read_file';

export function createReplayAgent(
  fixturePath: string,
  ctx: AgentSetupContext<Config>,
): AgentProvider {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as ReplayFixture;
  const commands = new Map(ctx.commands.map((c) => [c.id, c]));
  // Pre-flight every step at boot — fail before any reactor mutation, with all
  // mismatches at once, instead of mid-replay after expensive prior steps.
  const problems: string[] = [];
  for (const [i, step] of fixture.steps.entries()) {
    if (step.tool === WORKSPACE_WRITE || step.tool === WORKSPACE_READ) continue;
    const cmd = commands.get(step.tool);
    if (!cmd) {
      problems.push(`step ${i + 1}: no command registered for "${step.tool}"`);
      continue;
    }
    const parsed = cmd.inputSchema.safeParse(step.args);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(
          (e: { path: PropertyKey[]; message: string }) =>
            `${e.path.join('.') || '(root)'}: ${e.message}`,
        )
        .join('; ');
      problems.push(`step ${i + 1} (${step.tool}): ${detail}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `replay fixture ${fixturePath} is invalid:\n  ${problems.join('\n  ')}`,
    );
  }
  // One replay per session thread; later turns are inert (the build is done).
  const replayed = new Set<string>();

  async function runStep(step: ReplayStep): Promise<unknown> {
    if (step.tool === WORKSPACE_WRITE) {
      const rel = String(step.args.path);
      const content = String(step.args.content);
      const abs = path.join(ctx.workdir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
      return { text: `Wrote ${Buffer.byteLength(content)} bytes to ${rel}` };
    }
    if (step.tool === WORKSPACE_READ) {
      const rel = String(step.args.path);
      const text = await readFile(path.join(ctx.workdir, rel), 'utf8').catch(
        () => '',
      );
      return { text };
    }
    const cmd = commands.get(step.tool);
    if (!cmd) throw new Error(`replay: no command registered for "${step.tool}"`);
    const input = cmd.inputSchema.parse(step.args);
    return cmd.execute(input, ctx.context);
  }

  return {
    id: 'vetra-agent',
    name: 'Vetra Agent',
    async *stream(_prompt, opts): AsyncGenerator<StreamChunk> {
      const threadId = opts?.threadId ?? 'default';
      if (replayed.has(threadId)) {
        yield {
          type: 'text-delta',
          text: 'This session was already built by the replay agent.',
        };
        return;
      }
      replayed.add(threadId);

      for (const [i, step] of fixture.steps.entries()) {
        if (opts?.abortSignal?.aborted) return;
        const toolCallId = randomUUID();
        yield { type: 'tool-call', toolCallId, toolName: step.tool, args: step.args };

        let result: unknown;
        let isError = false;
        try {
          result = await runStep(step);
        } catch (err) {
          isError = true;
          result = { error: err instanceof Error ? err.message : String(err) };
        }
        // Terse per-step trace to the CLI stdout — invaluable when a replayed
        // build fails (the agent transcript isn't otherwise captured in e2e).
        const summary =
          typeof result === 'string' ? result : JSON.stringify(result);
        console.log(
          `[replay] ${i + 1}/${fixture.steps.length} ${step.tool} ${isError ? 'ERROR' : 'ok'}: ${(summary ?? '').slice(0, 200)}`,
        );
        yield {
          type: 'tool-result',
          toolCallId,
          toolName: step.tool,
          result,
          isError,
        };
        // The recorded sequence is a known-good run, so any tool error is a
        // genuine regression — stop and surface it rather than limping on to a
        // confusing downstream assertion timeout.
        if (isError) {
          yield {
            type: 'error',
            error: `replay step "${step.tool}" failed: ${(result as { error: string }).error}`,
          };
          return;
        }
      }

      if (fixture.done) yield { type: 'text-delta', text: fixture.done };
    },
  };
}
