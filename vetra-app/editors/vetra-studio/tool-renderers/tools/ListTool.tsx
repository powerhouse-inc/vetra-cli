import { Fragment } from "react";
import { FolderTree } from "lucide-react";
import { ToolRow } from "../shared/ToolRow.js";
import { CodeBlock } from "../shared/CodeBlock.js";
import { asRecord, formatValue, pathOf, str } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/**
 * mastra_workspace_list_files. The result is the tool's tab-indented tree
 * (`.` root line, one `\t` per depth, dirs sorted first, no dir/file marker)
 * followed by a blank line and a "N directories, M files" summary. We reparse
 * that indentation into a nested tree and re-render it with box-drawing
 * connectors, and surface the non-path options as labeled chips.
 */
export function ListTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  const chips = optionChips(a);
  const resultText =
    formatValue(props.result) || (props.isError ? "Error" : "");

  return (
    <ToolRow
      icon={FolderTree}
      primary="List"
      detail={pathOf(a) ?? "."}
      detailMono
      state={props.state}
      isError={props.isError}
    >
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1 rounded bg-vetra-muted px-1.5 py-0.5 text-[11px]"
            >
              <span className="text-vetra-muted-fg">{c.label}</span>
              {c.value && (
                <span className="font-mono text-vetra-fg">{c.value}</span>
              )}
            </span>
          ))}
        </div>
      )}
      {props.isError ? (
        <CodeBlock label="error" value={resultText} tone="error" />
      ) : props.hasResult ? (
        <FileTree text={resultText} />
      ) : null}
    </ToolRow>
  );
}

type TreeNode = { name: string; children: TreeNode[] };

/** Box-drawing tree rendered from the tool's tab-indented listing. */
function FileTree({ text }: { text: string }) {
  const { nodes, summary } = parseListing(text);

  if (nodes.length === 0) {
    return (
      <div className="text-xs italic text-vetra-muted-fg">empty directory</div>
    );
  }

  return (
    <div>
      <div className="max-h-72 overflow-auto rounded bg-vetra-muted p-2 font-mono text-xs leading-relaxed">
        <TreeRows nodes={nodes} prefix="" keyBase="" />
      </div>
      {summary && (
        <div className="mt-1 text-[11px] text-vetra-muted-fg">{summary}</div>
      )}
    </div>
  );
}

function TreeRows({
  nodes,
  prefix,
  keyBase,
}: {
  nodes: TreeNode[];
  prefix: string;
  keyBase: string;
}) {
  return (
    <>
      {nodes.map((node, i) => {
        const isLast = i === nodes.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const childPrefix = prefix + (isLast ? "    " : "│   ");
        const isDir = node.children.length > 0;
        const key = `${keyBase}/${i}`;
        return (
          <Fragment key={key}>
            <div className="whitespace-pre">
              <span className="text-vetra-muted-fg">
                {prefix}
                {connector}
              </span>
              <span
                className={
                  isDir ? "font-medium text-vetra-primary" : "text-vetra-fg"
                }
              >
                {node.name}
              </span>
            </div>
            {isDir && (
              <TreeRows
                nodes={node.children}
                prefix={childPrefix}
                keyBase={key}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

const SUMMARY_RE =
  /^\d+ director(?:y|ies), \d+ files?(?: \(truncated at depth \d+\))?$/;

/** Parse the tab-indented listing into a nested tree + trailing summary line. */
function parseListing(text: string): { nodes: TreeNode[]; summary?: string } {
  const raw = text.split("\n");

  // Pull the trailing "N directories, M files" summary if present.
  let summary: string | undefined;
  let end = raw.length;
  for (let i = raw.length - 1; i >= 0; i--) {
    const t = raw[i].trim();
    if (!t) continue;
    if (SUMMARY_RE.test(t)) {
      summary = t;
      end = i;
    }
    break;
  }

  const lines = raw.slice(0, end).filter((l) => l.trim().length > 0);
  // Drop the leading "." root marker; remaining depth-0 entries are top level.
  if (lines[0]?.trim() === ".") lines.shift();

  // Indentation is tabs at runtime; detect a space step as a fallback.
  let spaceUnit = 0;
  for (const l of lines) {
    const s = /^ */.exec(l)![0].length;
    if (s > 0 && !l.startsWith("\t") && (spaceUnit === 0 || s < spaceUnit)) {
      spaceUnit = s;
    }
  }

  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  for (const line of lines) {
    const ws = /^[\t ]*/.exec(line)![0];
    const tabs = (ws.match(/\t/g) ?? []).length;
    const spaces = ws.length - tabs;
    const depth =
      tabs > 0 ? tabs : spaceUnit ? Math.round(spaces / spaceUnit) : 0;

    const node: TreeNode = { name: line.slice(ws.length), children: [] };
    if (depth === 0 || !stack[depth - 1]) roots.push(node);
    else stack[depth - 1].children.push(node);
    stack[depth] = node;
    stack.length = depth + 1;
  }

  return { nodes: roots, summary };
}

/** Non-path options worth surfacing as chips (skips no-op defaults). */
function optionChips(
  a: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const chips: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string | undefined) => {
    if (value) chips.push({ label, value });
  };
  const pattern = Array.isArray(a.pattern)
    ? a.pattern.filter((p): p is string => typeof p === "string").join(", ")
    : str(a.pattern);

  if (typeof a.maxDepth === "number") push("depth", String(a.maxDepth));
  push("pattern", pattern);
  push("ext", str(a.extension));
  push("exclude", str(a.exclude));
  if (a.dirsOnly === true) chips.push({ label: "dirs only", value: "" });
  if (a.showHidden === true) chips.push({ label: "hidden", value: "" });
  if (a.respectGitignore === false)
    chips.push({ label: "no gitignore", value: "" });
  return chips;
}
