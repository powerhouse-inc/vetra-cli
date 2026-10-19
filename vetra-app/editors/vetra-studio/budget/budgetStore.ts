import type { BudgetRequestResult, StudioLlmUsage } from "./budgetClient.js";

/** Spend share at which the meter turns to its warning state. */
export const BUDGET_WARNING_RATIO = 0.8;
/** One budget request per Studio per 24 h (the cloud enforces the same). */
export const BUDGET_REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A BUDGET_EXHAUSTED failure older than this (e.g. last month's, still in a
 * session's history) no longer marks the meter used up. */
const FAILURE_RECENT_MS = 24 * 60 * 60 * 1000;
const REQUEST_STORAGE_PREFIX = "vetra-studio:budget-requested:";

export type BudgetRequestState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "requested"; at: number }
  | { kind: "error"; message: string };

export type BudgetSnapshot = {
  /** Null outside a provisioned Studio (e.g. vite dev). */
  environmentId: string | null;
  /** Null until loaded, or when the Studio has no Vetra key. */
  usage: StudioLlmUsage | null;
  /** A recent BUDGET_EXHAUSTED failure, until the limit is raised. */
  exhaustedByFailure: boolean;
  request: BudgetRequestState;
};

export type BudgetLevel = "ok" | "warning" | "exhausted";

export type BudgetView = {
  level: BudgetLevel;
  /** "$1.50 of $5.00", "$1.50 used", or "" when the spend is unknown. */
  amount: string;
  /** 0–100 for the bar; null when unlimited or unknown. */
  percent: number | null;
  request: BudgetRequestState;
};

type KeyValueStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type BudgetDeps = {
  resolveEnvironmentId: () => Promise<string | null>;
  getToken: () => Promise<string | null>;
  fetchUsage: (
    environmentId: string,
    token: string,
  ) => Promise<StudioLlmUsage | null>;
  requestBudget: (
    environmentId: string,
    token: string,
  ) => Promise<BudgetRequestResult>;
  now: () => number;
  /** Remembers a sent request across reloads; null to keep it in memory. */
  storage: KeyValueStorage | null;
};

export type BudgetStore = {
  getSnapshot: () => BudgetSnapshot;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  request: () => Promise<void>;
  /** Called for each BUDGET_EXHAUSTED failure the chat shows. */
  markExhausted: (failedAt: string) => void;
};

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** What the meter shows for a snapshot; null when there is nothing to show. */
export function budgetView(s: BudgetSnapshot): BudgetView | null {
  const u = s.usage;
  if (!u && !s.exhaustedByFailure) return null;
  const limit = u?.limitUsd ?? null;
  const ratio = u && limit !== null && limit > 0 ? u.usageUsd / limit : null;
  const atLimit =
    u !== null && limit !== null && (limit <= 0 || u.usageUsd >= limit);
  const level: BudgetLevel =
    s.exhaustedByFailure || atLimit
      ? "exhausted"
      : ratio !== null && ratio >= BUDGET_WARNING_RATIO
        ? "warning"
        : "ok";
  const amount = !u
    ? ""
    : limit === null
      ? `${usd(u.usageUsd)} used`
      : `${usd(u.usageUsd)} of ${usd(limit)}`;
  const percent =
    level === "exhausted"
      ? 100
      : ratio === null
        ? null
        : Math.min(100, Math.round(ratio * 100));
  return { level, amount, percent, request: s.request };
}

function readRequestedAt(
  storage: KeyValueStorage | null,
  environmentId: string,
): number | null {
  try {
    const raw = storage?.getItem(REQUEST_STORAGE_PREFIX + environmentId);
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

function writeRequestedAt(
  storage: KeyValueStorage | null,
  environmentId: string,
  at: number,
): void {
  try {
    storage?.setItem(REQUEST_STORAGE_PREFIX + environmentId, String(at));
  } catch {
    // Private mode / blocked storage: the request is remembered in memory.
  }
}

/** Budget state shared by the top-bar meter and the chat's failure action. */
export function createBudgetStore(deps: BudgetDeps): BudgetStore {
  let snapshot: BudgetSnapshot = {
    environmentId: null,
    usage: null,
    exhaustedByFailure: false,
    request: { kind: "idle" },
  };
  const listeners = new Set<() => void>();
  let envPromise: Promise<string | null> | null = null;
  /** Limit at the time of the failure; a higher one means it was raised. */
  let failureLimit: number | null | undefined;
  const seenFailures = new Set<string>();

  function set(next: Partial<BudgetSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const l of listeners) l();
  }

  function environment(): Promise<string | null> {
    envPromise ??= deps.resolveEnvironmentId().then((id) => {
      if (id && snapshot.environmentId !== id) {
        const at = readRequestedAt(deps.storage, id);
        set({
          environmentId: id,
          ...(at !== null && deps.now() - at < BUDGET_REQUEST_WINDOW_MS
            ? { request: { kind: "requested", at } }
            : {}),
        });
      }
      return id;
    });
    envPromise.catch(() => {
      envPromise = null;
    });
    return envPromise;
  }

  function requestStillOpen(): boolean {
    const r = snapshot.request;
    return (
      r.kind === "sending" ||
      (r.kind === "requested" && deps.now() - r.at < BUDGET_REQUEST_WINDOW_MS)
    );
  }

  async function refresh(): Promise<void> {
    const env = await environment().catch(() => null);
    if (!env) return;
    if (snapshot.request.kind === "requested" && !requestStillOpen())
      set({ request: { kind: "idle" } });
    const token = await deps.getToken();
    if (!token) return;
    const usage = await deps.fetchUsage(env, token);
    // Keep the last known value through a failed fetch.
    if (!usage) return;
    if (failureLimit === undefined && snapshot.exhaustedByFailure)
      failureLimit = usage.limitUsd;
    const raised =
      snapshot.exhaustedByFailure &&
      failureLimit !== undefined &&
      failureLimit !== null &&
      (usage.limitUsd === null || usage.limitUsd > failureLimit);
    if (raised) failureLimit = undefined;
    set({
      usage,
      exhaustedByFailure: raised ? false : snapshot.exhaustedByFailure,
    });
  }

  async function request(): Promise<void> {
    if (requestStillOpen()) return;
    set({ request: { kind: "sending" } });
    const env = await environment().catch(() => null);
    if (!env) {
      set({
        request: {
          kind: "error",
          message: "This Studio is not connected to Vetra cloud.",
        },
      });
      return;
    }
    const token = await deps.getToken();
    if (!token) {
      set({
        request: {
          kind: "error",
          message: "Sign in with Renown to request more budget.",
        },
      });
      return;
    }
    const result = await deps.requestBudget(env, token);
    if (!result.ok) {
      set({ request: { kind: "error", message: result.message } });
      return;
    }
    // recorded === false: a request is already open — same outcome for the customer.
    const at = deps.now();
    writeRequestedAt(deps.storage, env, at);
    set({ request: { kind: "requested", at } });
  }

  function markExhausted(failedAt: string): void {
    if (seenFailures.has(failedAt)) return;
    seenFailures.add(failedAt);
    const at = Date.parse(failedAt);
    if (!Number.isFinite(at) || deps.now() - at > FAILURE_RECENT_MS) return;
    if (snapshot.exhaustedByFailure) return;
    failureLimit = snapshot.usage ? snapshot.usage.limitUsd : undefined;
    set({ exhaustedByFailure: true });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    request,
    markExhausted,
  };
}
