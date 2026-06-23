import { TerminalSquare } from "lucide-react";
import { ToolRow } from "../shared/ToolRow.js";
import { TerminalBlock } from "../shared/Terminal.js";
import { asRecord, formatValue, str } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/**
 * Bash / shell / mastra_workspace_execute_command. Collapsed line is the raw
 * command; expanded shows a dark terminal panel with `$ command` + its output.
 */
export function BashTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  const command = str(a.command) ?? "command";
  const output = formatValue(props.result);

  return (
    <ToolRow
      icon={TerminalSquare}
      primary={command}
      primaryMono
      state={props.state}
      isError={props.isError}
    >
      <TerminalBlock command={command} output={output} />
    </ToolRow>
  );
}
