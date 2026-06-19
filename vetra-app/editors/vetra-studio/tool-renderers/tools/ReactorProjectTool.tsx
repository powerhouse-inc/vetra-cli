import { Hammer, Package } from "lucide-react";
import { CommandTool } from "../shared/CommandTool.js";
import { asRecord, str } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/** reactor-project-* (package lifecycle). Hammer for build, package otherwise. */
export function ReactorProjectTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  return (
    <CommandTool
      {...props}
      icon={props.toolName.includes("build") ? Hammer : Package}
      detail={str(a.name) ?? str(a.project) ?? str(a.package)}
    />
  );
}
