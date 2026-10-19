import { useRenown } from "@powerhousedao/reactor-browser";
import { useEffect, useSyncExternalStore } from "react";
import { getAuthToken } from "../deploy/cloudClient.js";
import { resolveStudioEnvironmentId } from "../hooks/preview-server-client.js";
import { fetchStudioLlmUsage, requestMoreBudget } from "./budgetClient.js";
import {
  createBudgetStore,
  type BudgetSnapshot,
  type BudgetStore,
} from "./budgetStore.js";

/** The cloud caches usage for 60 s; polling faster gains nothing. */
const POLL_INTERVAL_MS = 60_000;

/** The Renown session the shared store fetches with (set by the hook). */
let currentRenown: unknown = null;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

let store: BudgetStore | null = null;
function sharedStore(): BudgetStore {
  store ??= createBudgetStore({
    resolveEnvironmentId: resolveStudioEnvironmentId,
    getToken: () => getAuthToken(currentRenown),
    fetchUsage: fetchStudioLlmUsage,
    requestBudget: requestMoreBudget,
    now: () => Date.now(),
    storage: browserStorage(),
  });
  return store;
}

let pollers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function startPolling(s: BudgetStore): () => void {
  pollers += 1;
  if (pollers === 1) {
    void s.refresh();
    timer = setInterval(() => void s.refresh(), POLL_INTERVAL_MS);
  }
  return () => {
    pollers -= 1;
    if (pollers === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export type StudioBudget = {
  snapshot: BudgetSnapshot;
  request: () => void;
  markExhausted: (failedAt: string) => void;
};

/** The Studio's LLM budget, polled every 60 s while any consumer is mounted.
 * The top bar and the chat's failure action share one store. */
export function useStudioBudget(): StudioBudget {
  const renown = useRenown();
  const s = sharedStore();
  const snapshot = useSyncExternalStore(s.subscribe, s.getSnapshot);

  useEffect(() => {
    const changed = renown !== currentRenown;
    currentRenown = renown;
    // A sign-in after polling started: fetch now rather than at the next tick.
    if (changed && renown && pollers > 0) void s.refresh();
  }, [renown, s]);

  useEffect(() => startPolling(s), [s]);

  return {
    snapshot,
    request: () => void s.request(),
    markExhausted: s.markExhausted,
  };
}
