import type { LucideIcon } from "lucide-react";
import { ToolRow } from "./ToolRow.js";
import { ToolResult } from "./ToolResult.js";
import type { ToolRenderProps } from "../types.js";

/**
 * Command-style tool line: icon + name + muted "· <detail>" + success check,
 * expanding to the args/result. A convenience base for the domain CLI tools
 * (spec, reactor-project, deploy-environment…). A tool that needs a bespoke
 * look should stop using this and compose ToolRow directly in its own file.
 */
export function CommandTool({
  icon,
  label,
  detail,
  ...props
}: ToolRenderProps & { icon: LucideIcon; label?: string; detail?: string }) {
  return (
    <ToolRow
      icon={icon}
      primary={label ?? props.toolName}
      detail={detail ? `· ${detail}` : undefined}
      showStatus
      state={props.state}
      isError={props.isError}
    >
      <ToolResult {...props} />
    </ToolRow>
  );
}
