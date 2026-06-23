import { PenLine } from "lucide-react";
import { ToolRow } from "../shared/ToolRow.js";
import { ToolResult } from "../shared/ToolResult.js";
import { asRecord, pathOf } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/** Write / mastra_workspace_write_file. */
export function WriteTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  return (
    <ToolRow
      icon={PenLine}
      primary="Write"
      detail={pathOf(a)}
      detailMono
      state={props.state}
      isError={props.isError}
    >
      <ToolResult {...props} />
    </ToolRow>
  );
}
