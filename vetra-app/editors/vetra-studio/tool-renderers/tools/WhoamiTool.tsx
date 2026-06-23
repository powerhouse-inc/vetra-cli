import { User } from "lucide-react";
import { CommandTool } from "../shared/CommandTool.js";
import type { ToolRenderProps } from "../types.js";

/** whoami — authenticated user info. */
export function WhoamiTool(props: ToolRenderProps) {
  return <CommandTool {...props} icon={User} label="whoami" />;
}
