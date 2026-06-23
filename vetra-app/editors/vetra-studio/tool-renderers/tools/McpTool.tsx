import { Plug } from "lucide-react";
import { CommandTool } from "../shared/CommandTool.js";
import { asRecord, firstStringValue } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

const MCP_MARKER = "mcp__";

/** Any MCP tool ("{service}[-{suffix}]-mcp__{tool}") — shown by its bare name. */
export function McpTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  const idx = props.toolName.indexOf(MCP_MARKER);
  const bare =
    idx !== -1
      ? props.toolName.slice(idx + MCP_MARKER.length) || props.toolName
      : props.toolName;
  return (
    <CommandTool
      {...props}
      icon={Plug}
      label={bare}
      detail={firstStringValue(a)}
    />
  );
}
