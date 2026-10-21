import { createOpenRouter, type LanguageModelV2 } from '@openrouter/ai-sdk-provider';
import { DEFAULT_MODEL_FALLBACKS, type Config } from '../framework.js';

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
/** Output caps per request (max_tokens). Without them a request asks for the model's full output window. */
export const MAIN_MAX_OUTPUT_TOKENS = 8192;
export const SUBAGENT_MAX_OUTPUT_TOKENS = 16384;
export const MEMORY_MAX_OUTPUT_TOKENS = 4096;
/** Hard ceiling on the TokenLimiterProcessor input limit, whatever the model's context window. */
export const INPUT_TOKEN_CAP = 64_000;

/** The model type the agent and generateText consume (ai v5 / provider spec v2). */
export type LanguageModel = LanguageModelV2;

export const SUPPORTED_PROVIDERS = ['openrouter'] as const;

export interface LlmSettings {
  provider: 'openrouter';
  apiKey: string;
  model: string;
  subagentModel: string;
  memoryModel: string;
  /** Model for understanding pictures and documents; defaults to the main model. */
  understandModel: string;
  /** The configured fallbacks; undefined means the default chain (see resolveFallbacks). */
  fallbacks: string[] | undefined;
  allowDataCollection: boolean;
}

export type LlmConfigInput = Pick<Config, 'model' | 'memoryModel' | 'llmAllowDataCollection'> &
  Partial<Pick<Config, 'subagentModel' | 'modelFallbacks' | 'openrouterApiKey' | 'llmProvider' | 'understandModel'>>;

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

/**
 * VETRA_MODEL_FALLBACKS: unset or blank → undefined (use the default chain);
 * `none` (any case) → [] (no fallbacks); else the trimmed, non-empty entries.
 */
export function parseFallbacks(raw: string | undefined): string[] | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === 'none') return [];
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The fallbacks for one primary model: the configured list, else the default
 * chain; never the primary itself, no duplicates, at most MAX_FALLBACKS.
 */
export function resolveFallbacks(primary: string, configured: string[] | undefined): string[] {
  const chain = configured ?? DEFAULT_MODEL_FALLBACKS;
  return [...new Set(chain.filter((f) => f !== primary))].slice(0, MAX_FALLBACKS);
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
  s: { fallbacks: string[]; allowDataCollection: boolean },
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
  const provider = config.llmProvider?.trim().toLowerCase() || 'openrouter';
  if (provider !== 'openrouter') {
    throw new Error(`Unknown model provider "${config.llmProvider}". This Studio supports: ${SUPPORTED_PROVIDERS.join(', ')}.`);
  }
  const apiKey = resolveOpenRouterKey(config, env);
  if (!apiKey) return null;
  return {
    provider,
    apiKey,
    model: config.model,
    subagentModel: config.subagentModel?.trim() || config.model,
    memoryModel: config.memoryModel,
    understandModel: config.understandModel?.trim() || config.model,
    fallbacks: parseFallbacks(config.modelFallbacks),
    allowDataCollection: config.llmAllowDataCollection === true,
  };
}

/** The single place a provider client is built. */
export function createModel(
  s: LlmSettings,
  opts: { modelId: string; maxOutputTokens: number; fallbacks?: string[]; fetch?: typeof fetch },
): LanguageModel {
  const provider = createOpenRouter({
    apiKey: s.apiKey,
    headers: { ...OPENROUTER_ATTRIBUTION_HEADERS },
    // strict: send stream_options so usage (incl. usage.cost) arrives in the last SSE chunk.
    compatibility: 'strict',
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  // max_tokens goes in extraBody, which the provider merges last, so it caps
  // whatever maxOutputTokens the caller (Mastra) asks for.
  return provider.chat(opts.modelId, {
    usage: { include: true },
    extraBody: {
      ...requestExtras(opts.modelId, {
        fallbacks: opts.fallbacks ?? resolveFallbacks(opts.modelId, s.fallbacks),
        allowDataCollection: s.allowDataCollection,
      }),
      max_tokens: opts.maxOutputTokens,
    },
  });
}

export function createLlmModels(s: LlmSettings, opts: { fetch?: typeof fetch } = {}) {
  const make = (modelId: string, maxOutputTokens: number) =>
    createModel(s, { modelId, maxOutputTokens, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  return {
    main: make(s.model, MAIN_MAX_OUTPUT_TOKENS),
    subagent: make(s.subagentModel, SUBAGENT_MAX_OUTPUT_TOKENS),
    memory: make(s.memoryModel, MEMORY_MAX_OUTPUT_TOKENS),
  };
}

/** USD cost OpenRouter reports for one call (usage.cost), or null when absent. */
export function callCostUsd(result: { providerMetadata?: unknown }): number | null {
  const meta = result.providerMetadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined;
  const cost = meta?.openrouter?.usage?.cost;
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : null;
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
