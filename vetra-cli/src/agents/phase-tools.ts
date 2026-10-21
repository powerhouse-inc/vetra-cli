/**
 * Per-phase tool sets (spec §6.4): the main agent sees only the tools of the
 * current step of the active change, read from the `vetra/studio-product`
 * document. Tool schemas are most of the fixed prompt, so a narrower set means
 * smaller prompts and fewer wrong-tool detours.
 *
 * - No product document, or no active change → every tool (phase NONE).
 * - An active change → ALWAYS_ON ∪ the sets of its WORKING steps (a step sent
 *   back is WORKING again), or, with none WORKING, the set of its first step
 *   that isn't finished (F18). Deploy and GitHub tools are in no phase set, so
 *   they stay hidden for the whole of a build or change.
 * - The product document can't be read → every tool (logged); a failed read
 *   never breaks the turn.
 *
 * Patterns are anchored globs; only `*` is special.
 */
import type { ProcessInputStepArgs, ProcessInputStepResult, Processor } from '@mastra/core/processors';
import type { StepKind, StudioProductState } from 'vetra-app/document-models/studio-product';
import { IN_PROGRESS, getProductDoc, type ProductContext } from '../product/product-doc.js';

/** Read-only workspace, progress, skills and identity: visible in every phase. */
export const ALWAYS_ON: readonly string[] = [
  'mastra_workspace_read_file',
  'mastra_workspace_list_files',
  'mastra_workspace_file_stat',
  'mastra_workspace_grep',
  'product-progress',
  'skill',
  'skill_read',
  'skill_search',
  'whoami',
  // Read-only project status: every phase's gate is checked with these.
  'reactor-project-ls',
  'reactor-project-ps',
  'reactor-project-logs',
  // Reading what the customer attached to the message.
  'attachment-stat',
  'attachment-get',
];

/** The spec tools that build models and editors (F2). */
const SPEC_BUILD = ['spec-create', 'spec-update', 'spec-get', 'spec-list', 'spec-schema*', 'spec-generate'];
const WORKSPACE_WRITE = ['mastra_workspace_write_file', 'mastra_workspace_edit_file'];
/** Shell, for installs and leftover skill steps (tests and builds go through the recorded tools). */
const SHELL = 'mastra_workspace_execute_command';
/**
 * The running project's reactor MCP tools (ph-clint names them
 * `${service.id}-mcp__*`): test and preview documents only — models are
 * built through `spec-*` (F2).
 */
export const PROJECT_MCP = 'reactor-project-mcp__*';
const ATTACHMENTS = ['attachment-preprocess', 'attachment-upload'];

export const PHASE_TOOLS: Record<StepKind | 'NONE', readonly string[]> = {
  // Bootstrap first, then product specs at the workspace root (and naming
  // the product). The project installs while the specs are written; without
  // init/start here the agent read "go straight to init" as "no init tool".
  PLAN: [
    ...SPEC_BUILD,
    'spec-delete',
    'spec-extract',
    'reactor-project-init',
    'reactor-project-start',
    'reactor-project-stop',
    'reactor-project-restart',
  ],
  // Bootstrap + Model: project, spec-driven model, hand-written reducers.
  DATA: [
    ...SPEC_BUILD,
    'spec-preview-*',
    ...WORKSPACE_WRITE,
    SHELL,
    'reactor-project-init',
    'reactor-project-start',
    'reactor-project-stop',
    'reactor-project-restart',
    'reactor-project-check',
    'reactor-project-build',
    PROJECT_MCP,
    ...ATTACHMENTS,
    'agent-agentDocumentModel',
  ],
  // Editor + Preview + App.
  EDITORS: [
    ...SPEC_BUILD,
    'spec-preview-*',
    ...WORKSPACE_WRITE,
    SHELL,
    'reactor-project-start',
    'reactor-project-restart',
    'reactor-project-check',
    'reactor-project-build',
    PROJECT_MCP,
    ...ATTACHMENTS,
    'agent-agentEditor',
    'agent-agentApp',
  ],
  // Checks, reducer tests, preview smoke.
  TESTS: ['reactor-project-check', 'reactor-project-build', ...WORKSPACE_WRITE, SHELL, PROJECT_MCP],
  // Launch is automatic (§6.5): nothing beyond ALWAYS_ON, no deploy tools.
  LIVE: [],
  // No product or no active change: every tool, unchanged behaviour.
  NONE: ['*'],
};

/**
 * Tools in no phase set: reachable only with phase NONE (no active change,
 * e.g. Settings › Advanced requests). Listed so every registered tool is a
 * deliberate decision (the classification test enforces it).
 */
export const ADVANCED_ONLY: readonly string[] = [
  'deploy-*',
  'github-*',
  'reactor-project-publish',
  'reactor-project-publish-status',
  'reactor-project-manage',
  'vetra-studio-*',
  'vetra-agent-run',
  'claude-*',
  'config',
  'cli-docs',
  // Destructive or process-level workspace tools.
  'mastra_workspace_delete',
  'mastra_workspace_mkdir',
  'mastra_workspace_get_process_output',
  'mastra_workspace_kill_process',
  'mastra_workspace_lsp_inspect',
];

/** Step statuses that mean the step is finished. */
const FINISHED = new Set(['DONE', 'LIVE']);

function globToRegExp(pattern: string): RegExp {
  const body = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`);
}

/** Whether `name` matches any of the glob `patterns`. */
export function matchesAny(name: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(name));
}

/**
 * The phases whose tools the agent sees for `state`, or null for NONE (every
 * tool): no product, no active change, or an active change that is no longer
 * open.
 */
export function activePhases(state: StudioProductState | null | undefined): StepKind[] | null {
  if (!state?.activeChangeId) return null;
  const change = state.changes.find((c) => c.id === state.activeChangeId);
  if (!change || !IN_PROGRESS.includes(change.status)) return null;
  const working = change.steps.filter((s) => s.status === 'WORKING').map((s) => s.kind);
  if (working.length > 0) return working;
  const next = change.steps.find((s) => !FINISHED.has(s.status));
  if (next) return [next.kind];
  // Not planned yet (the first step of any change is the plan), or every
  // step finished (waiting for launch).
  return change.steps.length === 0 ? ['PLAN'] : ['LIVE'];
}

/** The tool-name patterns for `phases` (null → NONE). */
export function phasePatterns(phases: StepKind[] | null): readonly string[] {
  if (!phases) return PHASE_TOOLS.NONE;
  return [...ALWAYS_ON, ...phases.flatMap((p) => PHASE_TOOLS[p])];
}

/** The names among `toolNames` the agent sees for `phases`. */
export function selectTools(toolNames: readonly string[], phases: StepKind[] | null): string[] {
  const patterns = phasePatterns(phases);
  return toolNames.filter((n) => matchesAny(n, patterns));
}

interface ToolCallLike {
  type?: string;
  toolName?: string;
  payload?: { toolName?: string };
}

interface StepLike {
  toolCalls?: ToolCallLike[];
  content?: ToolCallLike[];
  response?: { messages?: Array<{ role?: string; content?: unknown }> };
}

/**
 * Tool names the latest step called. Mastra's step records can carry them in
 * `toolCalls`, in `content`, or only in the latest assistant message of
 * `response.messages` (where `toolCalls` and `content` are empty), so all
 * three are read.
 */
function lastStepToolNames(steps: ProcessInputStepArgs['steps']): string[] {
  const last = steps.at(-1) as StepLike | undefined;
  if (!last) return [];
  const calls: ToolCallLike[] = [
    ...(last.toolCalls ?? []),
    ...(last.content ?? []).filter((c) => c.type === 'tool-call'),
  ];
  const assistant = [...(last.response?.messages ?? [])].reverse().find((m) => m.role === 'assistant');
  if (Array.isArray(assistant?.content)) {
    calls.push(...(assistant.content as ToolCallLike[]).filter((c) => c.type === 'tool-call'));
  }
  return calls.map((c) => c.toolName ?? c.payload?.toolName ?? '');
}

/** Whether the latest finished model step called `toolName`. */
function lastStepCalled(steps: ProcessInputStepArgs['steps'], toolName: string): boolean {
  return lastStepToolNames(steps).includes(toolName);
}

const CACHE_KEY = 'phases';

/**
 * Mastra input processor: limits the model's tools to the current step's set
 * at every step of the loop. The product document is read once per turn and
 * again after a step that called `product-progress` (which can move the step).
 */
export class PhaseToolsProcessor implements Processor<'phase-tools'> {
  readonly id = 'phase-tools';
  readonly name = 'Phase tools';

  constructor(
    private readonly ctx: ProductContext,
    private readonly readProduct: typeof getProductDoc = getProductDoc,
  ) {}

  private async resolvePhases(): Promise<StepKind[] | null> {
    try {
      const doc = await this.readProduct(this.ctx);
      return activePhases(doc?.state);
    } catch (err) {
      this.ctx.log?.warn?.(
        `[phase-tools] couldn't read the product document — showing every tool: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async processInputStep(args: ProcessInputStepArgs): Promise<ProcessInputStepResult | undefined> {
    const { state, steps, tools } = args;
    if (!(CACHE_KEY in state) || lastStepCalled(steps, 'product-progress')) {
      const phases = await this.resolvePhases();
      if (JSON.stringify(phases) !== JSON.stringify(state[CACHE_KEY])) {
        this.ctx.log?.debug?.(`[phase-tools] step ${args.stepNumber}: ${phases ? phases.join('+') : 'NONE'}`);
      }
      state[CACHE_KEY] = phases;
    }
    const phases = state[CACHE_KEY] as StepKind[] | null;
    if (!phases || !tools) return undefined;
    const visible = args.activeTools ?? Object.keys(tools);
    return { activeTools: selectTools(visible, phases) };
  }
}
