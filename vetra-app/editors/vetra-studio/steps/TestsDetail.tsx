import type { Change } from "document-models/studio-product";
import { checkList, type CheckStatus } from "./checkList.js";

const STATUS: Record<
  CheckStatus,
  { icon: string; text: string; tone: string }
> = {
  passed: { icon: "✓", text: "passed", tone: "text-success" },
  failed: { icon: "✕", text: "failed", tone: "text-destructive" },
  waived: { icon: "!", text: "allowed for now", tone: "text-warning" },
  "not-run": { icon: "○", text: "not run yet", tone: "text-muted-foreground" },
};

/**
 * Tests step detail (spec §5.2): the checks list, each passing or failing
 * with a one-line plain reason.
 */
export function TestsDetail({ change }: { change: Change | null }) {
  const lines = checkList(change);
  return (
    <section aria-label="Tests" className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {lines.map((line) => {
          const s = STATUS[line.status];
          return (
            <li key={line.kind} className="flex flex-col gap-0.5 px-4 py-2.5">
              <span className="flex items-center gap-2 text-sm text-foreground">
                <span aria-hidden className={s.tone}>
                  {s.icon}
                </span>
                <span className="font-medium">{line.label}</span>
                <span className={`text-xs ${s.tone}`}>{s.text}</span>
              </span>
              {line.reason && line.status !== "passed" ? (
                <span className="pl-6 text-xs text-muted-foreground">
                  {line.reason}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
