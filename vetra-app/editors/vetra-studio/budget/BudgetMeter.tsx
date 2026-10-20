import type {
  BudgetLevel,
  BudgetRequestState,
  BudgetView,
} from "./budgetStore.js";
import { budgetView } from "./budgetStore.js";
import { useStudioBudget } from "./useStudioBudget.js";

function chipClasses(level: BudgetLevel): string {
  switch (level) {
    case "ok":
      return "border-border bg-card text-muted-foreground";
    case "warning":
      return "border-warning/30 bg-warning/10 text-warning";
    case "exhausted":
      return "border-destructive/30 bg-destructive/10 text-destructive";
  }
}

function barClasses(level: BudgetLevel): string {
  switch (level) {
    case "ok":
      return "bg-vetra-primary";
    case "warning":
      return "bg-warning";
    case "exhausted":
      return "bg-destructive";
  }
}

/** "Request more budget" → "Requested — we'll raise it soon". Shared by the
 * top bar and the chat's failed-turn action. */
export function RequestBudgetControl({
  request,
  onRequest,
}: {
  request: BudgetRequestState;
  onRequest: () => void;
}) {
  if (request.kind === "requested")
    return (
      <span className="text-xs font-medium text-muted-foreground">
        Requested — we&apos;ll raise it soon
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onRequest}
        disabled={request.kind === "sending"}
        className="rounded-lg bg-vetra-primary px-2.5 py-1 text-xs font-medium text-vetra-primary-fg shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-vetra-primary focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {request.kind === "sending" ? "Requesting…" : "Request more budget"}
      </button>
      {request.kind === "error" ? (
        <span role="alert" className="text-xs text-destructive">
          {request.message}
        </span>
      ) : null}
    </span>
  );
}

/** The Studio's LLM spend in the top bar: `$used of $limit`, a warning from
 * 80 %, and "Budget used up" with a request action at the limit. */
export function BudgetMeter({
  view,
  onRequest,
}: {
  view: BudgetView | null;
  onRequest: () => void;
}) {
  if (!view) return null;
  const exhausted = view.level === "exhausted";
  return (
    <div
      data-level={view.level}
      className="flex shrink-0 items-center gap-2"
      title="LLM budget this month"
    >
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${chipClasses(view.level)}`}
      >
        {exhausted ? <span>Budget used up</span> : null}
        {view.amount ? <span>{view.amount}</span> : null}
        {view.percent !== null ? (
          <span
            aria-hidden
            className="relative h-1.5 w-12 overflow-hidden rounded-full bg-accent"
          >
            <span
              className={`absolute inset-y-0 left-0 rounded-full ${barClasses(view.level)}`}
              style={{ width: `${view.percent}%` }}
            />
          </span>
        ) : null}
      </span>
      {exhausted ? (
        <RequestBudgetControl request={view.request} onRequest={onRequest} />
      ) : null}
    </div>
  );
}

/** The top-bar meter bound to the shared, polled budget store. */
export function StudioBudgetMeter() {
  const budget = useStudioBudget();
  return (
    <BudgetMeter
      view={budgetView(budget.snapshot)}
      onRequest={budget.request}
    />
  );
}
