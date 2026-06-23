import { FileText, PenLine } from "lucide-react";
import { CommandTool } from "../shared/CommandTool.js";
import { asRecord, isWriteVerb, str } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/** spec-* (document-model specs). Pencil for mutating verbs, doc icon for reads. */
export function SpecTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  return (
    <CommandTool
      {...props}
      icon={isWriteVerb(props.toolName) ? PenLine : FileText}
      detail={str(a.project) ?? str(a.name) ?? str(a.id)}
    />
  );
}
