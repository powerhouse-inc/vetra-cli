import { FileCode } from "lucide-react";
import { CommandTool } from "../shared/CommandTool.js";
import { asRecord, pathOf } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/** Other mastra_workspace_* tools not handled by a more specific component. */
export function WorkspaceTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  return <CommandTool {...props} icon={FileCode} detail={pathOf(a)} />;
}
