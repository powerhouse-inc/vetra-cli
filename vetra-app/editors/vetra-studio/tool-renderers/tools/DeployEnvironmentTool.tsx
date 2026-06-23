import { Cloud, Rocket } from "lucide-react";
import { CommandTool } from "../shared/CommandTool.js";
import { asRecord, str } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/** deploy-environment-* (cloud environments). Rocket for create, cloud otherwise. */
export function DeployEnvironmentTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  return (
    <CommandTool
      {...props}
      icon={props.toolName.includes("create") ? Rocket : Cloud}
      detail={str(a.name) ?? str(a.slug) ?? str(a.id)}
    />
  );
}
