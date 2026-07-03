import { FileText } from "lucide-react";
import { ToolRow } from "../shared/ToolRow.js";
import { CodeBlock } from "../shared/CodeBlock.js";
import { asRecord, formatValue, pathOf } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/**
 * Read / mastra_workspace_read_file. The file body is NOT persisted
 * (chat-bridge keeps only a header line: "path (lines a-b of N, M bytes)"), so
 * we surface the size + lines-read parsed from it rather than faking a file view.
 */
export function ReadTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  const resultText =
    formatValue(props.result) || (props.isError ? "Error" : "");
  const meta = parseReadSummary(resultText);

  return (
    <ToolRow
      icon={FileText}
      primary="Read"
      detail={pathOf(a)}
      detailMono
      state={props.state}
      isError={props.isError}
    >
      {props.isError ? (
        <CodeBlock label="error" value={resultText} tone="error" />
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {meta.lines && (
            <span>
              lines{" "}
              <span className="font-medium text-foreground">
                {meta.lines.start}–{meta.lines.end}
              </span>{" "}
              of{" "}
              <span className="font-medium text-foreground">
                {meta.lines.total}
              </span>
            </span>
          )}
          {meta.bytes != null && (
            <span>
              <span className="font-medium text-foreground">
                {meta.bytes.toLocaleString()}
              </span>{" "}
              bytes
            </span>
          )}
          {!meta.lines && meta.bytes == null && resultText && (
            <span className="font-mono">{resultText}</span>
          )}
        </div>
      )}
    </ToolRow>
  );
}

/** Parse the persisted read header, e.g. "path (lines 1-5 of 118, 3880 bytes)". */
function parseReadSummary(s: string): {
  bytes?: number;
  lines?: { start: number; end: number; total: number };
} {
  const bytes = /([\d,]+)\s*bytes/.exec(s);
  const lines = /lines\s+(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d+)/i.exec(s);
  return {
    bytes: bytes ? Number(bytes[1].replace(/,/g, "")) : undefined,
    lines: lines
      ? {
          start: Number(lines[1]),
          end: Number(lines[2]),
          total: Number(lines[3]),
        }
      : undefined,
  };
}
