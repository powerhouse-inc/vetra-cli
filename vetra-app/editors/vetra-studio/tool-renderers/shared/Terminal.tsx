import { useState } from "react";
import { Check, Copy, TerminalSquare } from "lucide-react";

// ANSI SGR escape codes (colors/styles) — stripped so raw output stays readable.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** Terminal panel: header + copy button, then `$ command` and its output. */
export function TerminalBlock({
  command,
  output,
}: {
  command: string;
  output?: string;
}) {
  const [copied, setCopied] = useState(false);
  const body = [command && `$ ${command}`, output?.replace(ANSI, "")]
    .filter(Boolean)
    .join("\n");

  const copy = () => {
    void navigator.clipboard.writeText(body).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted text-foreground">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TerminalSquare className="size-3.5" />
          Terminal
        </div>
        <button
          type="button"
          onClick={copy}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Copy terminal output"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">
        {body}
      </pre>
    </div>
  );
}
