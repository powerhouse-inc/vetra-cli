import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { Config } from '../framework.js';

/**
 * Every Mastra model of the agent (main, sub-agents, observational memory)
 * comes from here. OpenRouter is the only provider; the OpenRouter key is the
 * only credential the agent reads.
 */

/** App attribution on every OpenRouter request (header names verified in openrouter.ai/openapi.yaml). */
export const OPENROUTER_ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://vetra.io',
  'X-OpenRouter-Title': 'Vetra Studio',
} as const;
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const DEFAULT_CONTEXT_LENGTH = 200_000;
export const CONTEXT_LIMIT_RATIO = 0.8;
export const MAX_CONTEXT_TOKEN_LIMIT = 200_000;
export const MAX_FALLBACKS = 3;

export interface LlmSettings {
  apiKey: string;
  model: string;
  subagentModel: string;
  memoryModel: string;
  fallbacks: string[];
  allowDataCollection: boolean;
}

export type LlmConfigInput = Pick<Config, 'model' | 'memoryModel' | 'llmAllowDataCollection'> &
  Partial<Pick<Config, 'subagentModel' | 'modelFallbacks' | 'openrouterApiKey'>>;

/**
 * The OpenRouter key: the configured one (VETRA_OPENROUTER_API_KEY, or the
 * local/user config files setup-auth writes), else the bare
 * OPENROUTER_API_KEY the vetra-llm broker writes into the Studio's tenant
 * secrets (ph-clint only maps VETRA_-prefixed env names onto config fields).
 */
export function resolveOpenRouterKey(
  config: Pick<Partial<Config>, 'openrouterApiKey'>,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key = config.openrouterApiKey?.trim() || env.OPENROUTER_API_KEY?.trim();
  return key ? key : undefined;
}

export function parseFallbacks(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_FALLBACKS);
}

/** Anthropic prompt caching only applies to Anthropic models. */
export function usesAnthropicCache(modelId: string): boolean {
  return modelId.startsWith('anthropic/');
}

/**
 * The OpenRouter request extras for one model:
 * - provider preferences (privacy: no data collection unless allowed);
 * - fallbacks as `models` [primary, ...fallbacks];
 * - for anthropic/ models, top-level `cache_control`, which turns on automatic
 *   prompt caching (openapi.yaml AnthropicCacheControlDirective).
 *
 * ph-clint's wrapAgent cacheControl is NOT used: it sets
 * providerOptions.anthropic at call level, which the OpenRouter provider ignores.
 */
export function requestExtras(
  modelId: string,
  s: Pick<LlmSettings, 'fallbacks' | 'allowDataCollection'>,
): Record<string, unknown> {
  const extras: Record<string, unknown> = {
    provider: { data_collection: s.allowDataCollection ? 'allow' : 'deny' },
  };
  const fallbacks = s.fallbacks.filter((f) => f !== modelId);
  if (fallbacks.length > 0) extras.models = [modelId, ...fallbacks];
  if (usesAnthropicCache(modelId)) extras.cache_control = { type: 'ephemeral' };
  return extras;
}

/** Null when no OpenRouter key is configured: the agent then serves in connect-a-model mode. */
export function resolveLlmSettings(
  config: LlmConfigInput,
  env: Record<string, string | undefined> = process.env,
): LlmSettings | null {
  const apiKey = resolveOpenRouterKey(config, env);
  if (!apiKey) return null;
  return {
    apiKey,
    model: config.model,
    subagentModel: config.subagentModel?.trim() || config.model,
    memoryModel: config.memoryModel,
    fallbacks: parseFallbacks(config.modelFallbacks),
    allowDataCollection: config.llmAllowDataCollection === true,
  };
}

export function createLlmModels(s: LlmSettings, opts: { fetch?: typeof fetch } = {}) {
  const provider = createOpenRouter({
    apiKey: s.apiKey,
    headers: { ...OPENROUTER_ATTRIBUTION_HEADERS },
    // strict: send stream_options so usage (incl. usage.cost) arrives in the last SSE chunk.
    compatibility: 'strict',
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const make = (modelId: string, fallbacks: string[]) =>
    provider.chat(modelId, {
      usage: { include: true },
      extraBody: requestExtras(modelId, { fallbacks, allowDataCollection: s.allowDataCollection }),
    });
  return {
    main: make(s.model, s.fallbacks),
    subagent: make(s.subagentModel, s.fallbacks),
    // Observational memory runs in the background: no fallbacks.
    memory: make(s.memoryModel, []),
  };
}

const contextLimits = new Map<string, number>();

/**
 * The TokenLimiterProcessor ceiling for a model: min(80% of its OpenRouter
 * context_length, 200k) (fetched once per model per process on success, public endpoint, no
 * key), else 80% of 200k when the list is unreachable or lacks the model.
 */
export async function resolveContextTokenLimit(
  modelId: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<number> {
  const cached = contextLimits.get(modelId);
  if (cached !== undefined) return cached;
  let contextLength = DEFAULT_CONTEXT_LENGTH;
  // Only a successfully fetched list is cached. A transient failure or timeout
  // uses the fallback for this call without pinning it for the process.
  let fetched = false;
  try {
    const res = await (opts.fetch ?? fetch)(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: Array<{ id?: unknown; context_length?: unknown }> };
      const hit = body.data?.find((m) => m.id === modelId);
      if (typeof hit?.context_length === 'number' && hit.context_length > 0) contextLength = hit.context_length;
      fetched = true;
    }
  } catch {
    // Offline or slow: keep the fallback.
  }
  const limit = Math.min(Math.floor(contextLength * CONTEXT_LIMIT_RATIO), MAX_CONTEXT_TOKEN_LIMIT);
  if (fetched) contextLimits.set(modelId, limit);
  return limit;
}

export function clearContextLimitCache(): void {
  contextLimits.clear();
}
