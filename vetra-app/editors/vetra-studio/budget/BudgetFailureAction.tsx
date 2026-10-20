import type { TurnFailure } from "@powerhousedao/clint-common/document-models/chat-session";
import { useEffect, type ReactNode } from "react";
import { RequestBudgetControl } from "./BudgetMeter.js";
import type { StudioBudget } from "./useStudioBudget.js";

export const BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED";

function BudgetFailureAction({
  failedAt,
  budget,
}: {
  failedAt: string;
  budget: StudioBudget;
}) {
  const { markExhausted } = budget;
  // The top bar follows a fresh failure even before the usage poll catches up.
  useEffect(() => {
    markExhausted(failedAt);
  }, [failedAt, markExhausted]);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-destructive">
        Budget used up
      </span>
      <RequestBudgetControl
        request={budget.snapshot.request}
        onRequest={budget.request}
      />
    </div>
  );
}

/** The chat's `renderFailureAction`: "Request more budget" on a
 * BUDGET_EXHAUSTED turn; nothing for other failures (Retry covers those). */
export function budgetFailureAction(
  failure: TurnFailure,
  budget: StudioBudget,
): ReactNode {
  if (failure.code !== BUDGET_EXHAUSTED) return null;
  return <BudgetFailureAction failedAt={failure.failedAt} budget={budget} />;
}
