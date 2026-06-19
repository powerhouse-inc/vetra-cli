import { CodeBlock } from "./CodeBlock.js";
import { formatValue } from "./util.js";
import type { ToolRenderProps } from "../types.js";

/** Default expanded body: the call arguments and the result (or error). */
export function ToolResult({
  args,
  result,
  isError,
  hasResult,
}: ToolRenderProps) {
  const argsText = args === undefined ? "" : formatValue(args);
  const resultText = formatValue(result) || (isError ? "Error" : "");
  return (
    <>
      {argsText && <CodeBlock label="arguments" value={argsText} />}
      {hasResult && (
        <CodeBlock
          label={isError ? "error" : "result"}
          value={resultText}
          tone={isError ? "error" : "default"}
        />
      )}
    </>
  );
}
