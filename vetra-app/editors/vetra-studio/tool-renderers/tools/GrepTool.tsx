import { Search } from "lucide-react";
import { ToolRow } from "../shared/ToolRow.js";
import { ToolResult } from "../shared/ToolResult.js";
import { CodeBlock } from "../shared/CodeBlock.js";
import { asRecord, formatValue, str } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/**
 * Grep / Glob / mastra_workspace_grep — search file contents by regex.
 *
 * For the workspace grep we reparse the tool's text output (a `N matches
 * across M files` summary, a `---` rule, then `path:line:col: content` rows
 * with optional `path:line- content` context rows and `--` hunk gaps) into a
 * friendly summary + per-file grouped match list. Other search tools (and any
 * output we can't parse) fall back to the default args/result blocks.
 */
export function GrepTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  const label = props.toolName === "Glob" ? "Glob" : "Grep";
  const chips = optionChips(a);
  const parsed = props.hasResult ? parseGrep(formatValue(props.result)) : null;

  return (
    <ToolRow
      icon={Search}
      primary={label}
      detail={str(a.pattern)}
      detailMono
      state={props.state}
      isError={props.isError}
    >
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]"
            >
              <span className="text-muted-foreground">{c.label}</span>
              {c.value && (
                <span className="font-mono text-foreground">{c.value}</span>
              )}
            </span>
          ))}
        </div>
      )}
      {props.isError ? (
        <CodeBlock
          label="error"
          value={formatValue(props.result) || "Error"}
          tone="error"
        />
      ) : parsed ? (
        <GrepResult parsed={parsed} />
      ) : (
        <ToolResult {...props} />
      )}
    </ToolRow>
  );
}

type GrepMatch = { line: number; text: string; isContext: boolean };
type GrepFile = { path: string; matches: GrepMatch[] };
type ParsedGrep = {
  total: number;
  fileCount: number;
  truncated: boolean;
  files: GrepFile[];
  /** Lines we couldn't classify (e.g. a token-limit truncation notice). */
  extra: string[];
};

/** Friendly summary + per-file grouped matches. */
function GrepResult({ parsed }: { parsed: ParsedGrep }) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        {parsed.total === 0
          ? "No matches found"
          : `${count(parsed.total, "match", "matches")} in ${count(parsed.fileCount, "file", "files")}` +
            (parsed.truncated ? " (truncated)" : "")}
      </div>
      {parsed.files.length > 0 && (
        <div className="max-h-72 space-y-2 overflow-auto rounded bg-muted p-2">
          {parsed.files.map((file) => (
            <div key={file.path}>
              <div className="flex items-baseline gap-2">
                <span className="truncate font-mono text-xs font-medium text-vetra-primary">
                  {file.path}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {file.matches.filter((m) => !m.isContext).length}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-xs">
                {file.matches.map((m, i) => (
                  <div
                    key={`${m.line}-${i}`}
                    className="flex gap-2 whitespace-pre-wrap break-words"
                  >
                    <span className="shrink-0 select-none text-right text-muted-foreground">
                      {m.line}
                    </span>
                    <span
                      className={
                        m.isContext
                          ? "text-muted-foreground"
                          : "text-foreground"
                      }
                    >
                      {m.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {parsed.extra.map((line, i) => (
        <div key={i} className="text-[11px] italic text-muted-foreground">
          {line}
        </div>
      ))}
    </div>
  );
}

const SUMMARY_RE =
  /^(\d+) match(?:es)? across (\d+) files?(?: \(truncated[^)]*\))?$/;
const MATCH_RE = /^(.+?):(\d+):\d+: (.*)$/;
const CONTEXT_RE = /^(.+?):(\d+)- (.*)$/;

/**
 * Reparse the workspace grep output. Returns null when the text isn't in the
 * expected `summary` + `---` shape so the caller can fall back to raw blocks.
 */
function parseGrep(text: string): ParsedGrep | null {
  const lines = text.split("\n");
  const m = SUMMARY_RE.exec(lines[0] ?? "");
  if (!m || lines[1]?.trim() !== "---") return null;

  const groups = new Map<string, GrepMatch[]>();
  const extra: string[] = [];
  for (const line of lines.slice(2)) {
    if (line === "--" || line.trim() === "") continue;
    const hit = MATCH_RE.exec(line);
    const ctx = !hit ? CONTEXT_RE.exec(line) : null;
    const m2 = hit ?? ctx;
    if (!m2) {
      extra.push(line);
      continue;
    }
    const [, path, lineNo, body] = m2;
    const entry: GrepMatch = {
      line: Number(lineNo),
      text: body,
      isContext: !hit,
    };
    const arr = groups.get(path);
    if (arr) arr.push(entry);
    else groups.set(path, [entry]);
  }

  return {
    total: Number(m[1]),
    fileCount: Number(m[2]),
    truncated: lines[0].includes("(truncated"),
    files: [...groups].map(([path, matches]) => ({ path, matches })),
    extra,
  };
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Non-pattern args worth surfacing as chips (skips no-op defaults). */
function optionChips(
  a: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const chips: Array<{ label: string; value: string }> = [];
  const path = str(a.path);
  if (path && path !== ".") chips.push({ label: "in", value: path });
  if (typeof a.contextLines === "number" && a.contextLines > 0)
    chips.push({ label: "context", value: String(a.contextLines) });
  if (typeof a.maxCount === "number")
    chips.push({ label: "max", value: String(a.maxCount) });
  if (a.caseSensitive === false)
    chips.push({ label: "case-insensitive", value: "" });
  if (a.includeHidden === true) chips.push({ label: "hidden", value: "" });
  return chips;
}
