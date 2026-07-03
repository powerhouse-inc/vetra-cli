import { cx } from "./util.js";

/** Monospace, scrollable arg/result block. Renders nothing when empty. */
export function CodeBlock({
  label,
  value,
  tone = "default",
}: {
  label?: string;
  value: string;
  tone?: "default" | "error";
}) {
  if (!value) return null;
  return (
    <div>
      {label && (
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      )}
      <pre
        className={cx(
          "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs",
          tone === "error" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </pre>
    </div>
  );
}
