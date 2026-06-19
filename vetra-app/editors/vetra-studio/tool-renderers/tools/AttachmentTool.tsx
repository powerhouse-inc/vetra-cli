import { Paperclip } from "lucide-react";
import { CommandTool } from "../shared/CommandTool.js";
import { asRecord, pathOf, str } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/** attachment-* (upload / preprocess). */
export function AttachmentTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  return (
    <CommandTool
      {...props}
      icon={Paperclip}
      detail={str(a.filename) ?? pathOf(a)}
    />
  );
}
