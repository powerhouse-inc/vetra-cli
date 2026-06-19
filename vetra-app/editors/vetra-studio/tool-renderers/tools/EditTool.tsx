import { PenLine } from "lucide-react";
import { ToolRow } from "../shared/ToolRow.js";
import { ToolResult } from "../shared/ToolResult.js";
import { asRecord, pathOf } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/** Edit / NotebookEdit / mastra_workspace_edit_file. */
export function EditTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  const primary =
    props.toolName === "mastra_workspace_edit_file" ? "Edit File" : "Edit";
  return (
    <ToolRow
      icon={PenLine}
      primary={primary}
      detail={pathOf(a)}
      detailMono
      state={props.state}
      isError={props.isError}
    >
      <ToolResult {...props} />
    </ToolRow>
  );
}
