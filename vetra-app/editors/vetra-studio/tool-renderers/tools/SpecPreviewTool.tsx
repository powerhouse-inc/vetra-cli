import { Presentation } from "lucide-react";
import { CommandTool } from "../shared/CommandTool.js";
import { asRecord, str } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/** spec-preview-* (preview instances of a spec). */
export function SpecPreviewTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  return (
    <CommandTool
      {...props}
      icon={Presentation}
      label="Spec preview"
      detail={str(a.name)}
    />
  );
}
