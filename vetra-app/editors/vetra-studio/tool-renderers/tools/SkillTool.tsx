import { Sparkles } from "lucide-react";
import { asRecord, str } from "../shared/util.js";
import type { ToolRenderProps } from "../types.js";

/**
 * skill / skill_read. Just announces the skill in use — no expand, no result
 * text (the response isn't relevant to the reader here).
 */
export function SkillTool(props: ToolRenderProps) {
  const a = asRecord(props.args);
  const isRead = props.toolName === "skill_read";
  const name = isRead ? (str(a.skillName) ?? str(a.name)) : str(a.name);
  const label = isRead ? "Reading skill" : "Using skill";

  return (
    <div className="flex items-center gap-2 py-0.5 text-sm text-vetra-muted-fg">
      <Sparkles className="size-4 shrink-0" />
      <span>
        {label}:{" "}
        <span className="font-medium text-vetra-fg">{name ?? "skill"}</span>
      </span>
    </div>
  );
}
