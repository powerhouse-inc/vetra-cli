import { gql } from "../deploy/githubConnect.js";

/** The Studio's LLM spend this month (cloud `vetraLlm.studioLlmUsage`). */
export type StudioLlmUsage = {
  /** VETRA (Vetra budget) or BYO (the user's own OpenRouter account). */
  source: string;
  model: string;
  usageUsd: number;
  /** Null when unlimited. */
  limitUsd: number | null;
  /** ISO; null when the limit does not reset. */
  resetsAt: string | null;
};

export type BudgetRequestResult =
  /** `recorded: false` = a request is already open (at most one per 24 h). */
  { ok: true; recorded: boolean } | { ok: false; message: string };

const USAGE_QUERY = `query StudioLlmUsage($environmentId: String!) {
  vetraLlm {
    studioLlmUsage(environmentId: $environmentId) {
      source
      model
      usageUsd
      limitUsd
      resetsAt
    }
  }
}`;

const REQUEST_MUTATION = `mutation RequestStudioLlmBudget($environmentId: String!) {
  vetraLlm {
    requestStudioLlmBudget(environmentId: $environmentId)
  }
}`;

/** This month's usage for the Studio. Null without a key, or when the cloud
 * can't be reached — the meter then keeps its last known value. */
export async function fetchStudioLlmUsage(
  environmentId: string,
  token: string,
): Promise<StudioLlmUsage | null> {
  const { data, errorMessage } = await gql<{
    vetraLlm: { studioLlmUsage: StudioLlmUsage | null } | null;
  }>(USAGE_QUERY, { environmentId }, token);
  if (errorMessage) return null;
  return data?.vetraLlm?.studioLlmUsage ?? null;
}

const REQUEST_ERROR_MESSAGES: Partial<Record<string, string>> = {
  FORBIDDEN: "Only the Studio's operators can request more budget.",
  UNAUTHENTICATED: "Your session expired. Sign in again, then try again.",
  NOT_FOUND: "This Studio was not found in Vetra cloud.",
  NETWORK_ERROR:
    "Vetra cloud could not be reached. Check your connection and try again.",
};

/** Customer-readable text for a failed budget request. */
export function budgetRequestErrorMessage(error: string): string {
  const known = REQUEST_ERROR_MESSAGES[error];
  if (known) return known;
  // A bare code (e.g. INTERNAL, HTTP_502) reads poorly on its own.
  if (/^[A-Z0-9_]+$/.test(error))
    return `Could not request more budget (${error}). Try again in a moment.`;
  return `Could not request more budget: ${error}`;
}

/** Asks the Vetra team for more LLM budget for the Studio. */
export async function requestMoreBudget(
  environmentId: string,
  token: string,
): Promise<BudgetRequestResult> {
  const { data, errorMessage } = await gql<{
    vetraLlm: { requestStudioLlmBudget: boolean } | null;
  }>(REQUEST_MUTATION, { environmentId }, token);
  if (errorMessage)
    return { ok: false, message: budgetRequestErrorMessage(errorMessage) };
  const recorded = data?.vetraLlm?.requestStudioLlmBudget;
  if (typeof recorded !== "boolean")
    return {
      ok: false,
      message: budgetRequestErrorMessage("EMPTY_RESPONSE"),
    };
  return { ok: true, recorded };
}
