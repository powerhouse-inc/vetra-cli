/**
 * Cost accounting for the agent eval.
 *
 * Source of truth for prices: litellm's `model_prices_and_context_window.json`,
 * a community-maintained JSON table that LiteLLM publishes on GitHub. We
 * fetch it on first use and cache to `~/.cache/vetra/litellm-prices.json`
 * with a 7-day TTL. The keys are LiteLLM's canonical model ids (eg.
 * `claude-sonnet-4-5-20250929`) — `MODEL_ID_ALIASES` maps the agent's
 * configured id (`anthropic/claude-sonnet-4-5`) onto a lookup key.
 *
 * Why litellm: keeps Anthropic/OpenAI/Google rates updated by the OSS
 * community rather than baking them into this repo and forgetting to bump.
 * If the network is unreachable and there's no cache, `loadPrices()` throws
 * — callers in the eval suite log the error and skip the cost line.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window_backup.json";

const CACHE_PATH = join(
  homedir(),
  ".cache",
  "vetra",
  "litellm-prices.json",
);

/** 7 days. The table changes infrequently; this caps how stale we can be. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Maps the model ids the Vetra agent uses (provider-prefixed slugs that
 * Mastra accepts) to the LiteLLM table keys (provider-suffixed, often
 * version-pinned). Add entries here when new agents come online.
 */
const MODEL_ID_ALIASES: Record<string, string> = {
  "anthropic/claude-sonnet-4-5": "claude-sonnet-4-5",
  "anthropic/claude-opus-4-7": "claude-opus-4-7",
  "anthropic/claude-haiku-4-5": "claude-haiku-4-5",
};

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningTokens: number;
}

export interface CostBreakdown {
  totalUsd: number;
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  modelKey: string;
}

interface LitellmEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
}

export function emptyUsage(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningTokens: 0,
  };
}

/**
 * Add a single `usage` payload (from a step-finish or finish chunk) into
 * an accumulator. Per-step `step-finish` usage is incremental for the
 * step; the final `finish` chunk's `totalUsage` covers the whole run.
 * The eval prefers `finish` when present (see `pickAuthoritative`) so the
 * accumulator's per-step sums don't double-count.
 */
export function addUsage(acc: UsageTotals, usage: Partial<UsageTotals>): void {
  if (typeof usage.inputTokens === "number") acc.inputTokens += usage.inputTokens;
  if (typeof usage.outputTokens === "number") acc.outputTokens += usage.outputTokens;
  if (typeof usage.cachedInputTokens === "number") acc.cachedInputTokens += usage.cachedInputTokens;
  if (typeof usage.cacheCreationInputTokens === "number") {
    acc.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  }
  if (typeof usage.reasoningTokens === "number") acc.reasoningTokens += usage.reasoningTokens;
}

/**
 * Resolve a price record for the given model id. Throws if neither the
 * cache nor the network knows the model — callers should treat that as a
 * "skip the cost line" signal, not a test failure.
 */
export async function computeCost(
  modelId: string,
  usage: UsageTotals,
): Promise<CostBreakdown> {
  const prices = await loadPrices();
  const key = MODEL_ID_ALIASES[modelId] ?? stripProviderPrefix(modelId);
  const entry = prices[key];
  if (!entry) {
    throw new Error(
      `No LiteLLM price entry for model "${modelId}" (tried key "${key}"). Add an alias in cost.ts.`,
    );
  }
  /* Anthropic's `inputTokens` is the *total* — it folds in both
   * `cache_read_input_tokens` and `cache_creation_input_tokens` alongside
   * the genuinely fresh tokens. To avoid double-charging cache-creation
   * tokens (once at the full input rate, again at the cache-write rate),
   * subtract both buckets to recover the truly non-cached remainder. */
  const nonCachedInput = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheCreationInputTokens,
  );
  const inputUsd = nonCachedInput * (entry.input_cost_per_token ?? 0);
  const outputUsd = usage.outputTokens * (entry.output_cost_per_token ?? 0);
  const cacheReadUsd =
    usage.cachedInputTokens * (entry.cache_read_input_token_cost ?? 0);
  const cacheWriteUsd =
    usage.cacheCreationInputTokens * (entry.cache_creation_input_token_cost ?? 0);
  return {
    totalUsd: inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd,
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheWriteUsd,
    modelKey: key,
  };
}

export function formatCostLine(
  usage: UsageTotals,
  cost: CostBreakdown,
): string {
  return [
    `cost $${cost.totalUsd.toFixed(4)} (${cost.modelKey})`,
    `in=${fmt(usage.inputTokens)}`,
    `out=${fmt(usage.outputTokens)}`,
    `cache-read=${fmt(usage.cachedInputTokens)}`,
    `cache-write=${fmt(usage.cacheCreationInputTokens)}`,
    usage.reasoningTokens > 0 ? `reasoning=${fmt(usage.reasoningTokens)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

async function loadPrices(): Promise<Record<string, LitellmEntry>> {
  if (existsSync(CACHE_PATH)) {
    const age = Date.now() - statSync(CACHE_PATH).mtimeMs;
    if (age < CACHE_TTL_MS) {
      try {
        return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
      } catch {
        /* Corrupt cache → fall through to refetch. */
      }
    }
  }
  const fetched = await fetchPrices();
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(fetched));
  } catch {
    /* Cache write is best-effort; the in-memory copy is still usable. */
  }
  return fetched;
}

async function fetchPrices(): Promise<Record<string, LitellmEntry>> {
  const res = await fetch(PRICES_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch LiteLLM prices: HTTP ${res.status}`);
  }
  return (await res.json()) as Record<string, LitellmEntry>;
}

function stripProviderPrefix(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

function fmt(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
