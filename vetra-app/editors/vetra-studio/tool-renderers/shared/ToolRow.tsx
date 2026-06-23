import { useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { cx } from "./util.js";
import type { ToolRenderState } from "../types.js";

export type ToolRowProps = {
  icon: LucideIcon;
  /** Medium-weight primary label. */
  primary: string;
  primaryMono?: boolean;
  /** Muted secondary text after `primary` (already includes any separator). */
  detail?: string;
  detailMono?: boolean;
  /** Show a success check when completed (off → only pending/error states show). */
  showStatus?: boolean;
  state: ToolRenderState;
  isError: boolean;
  children: ReactNode;
};

/**
 * Shared layout for a tool: a compact borderless line (icon + primary + muted
 * detail + status + chevron) that expands to reveal `children`. The header is
 * sized to its content and capped at 500px — the label ellipsis-truncates and
 * the chevron always hugs the end of the text. Expanded `children` are a
 * full-width block below. Tool components compose this; tweak per-tool look in
 * the tool's own file.
 */
export function ToolRow({
  icon: Icon,
  primary,
  primaryMono,
  detail,
  detailMono,
  showStatus,
  state,
  isError,
  children,
}: ToolRowProps) {
  const [open, setOpen] = useState(false);
  const pending = state === "input-available";
  const error = isError || state === "output-error";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/toolrow flex w-fit max-w-[500px] items-center gap-2 py-0.5 text-left text-sm text-vetra-fg transition-colors hover:text-vetra-primary"
      >
        <Icon className="size-4 shrink-0 text-vetra-muted-fg" />
        <span className="min-w-0 truncate">
          <span
            className={cx(primaryMono ? "font-mono text-xs" : "font-medium")}
          >
            {primary}
          </span>
          {detail && (
            <span
              className={cx(
                "text-vetra-muted-fg transition-colors group-hover/toolrow:text-vetra-fg",
                detailMono && "font-mono text-xs",
              )}
            >
              {" "}
              {detail}
            </span>
          )}
        </span>
        {pending && (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-vetra-info" />
        )}
        {error && (
          <AlertCircle className="size-3.5 shrink-0 text-vetra-destructive" />
        )}
        {showStatus && !pending && !error && (
          <CheckCircle2 className="size-3.5 shrink-0 text-vetra-success" />
        )}
        <ChevronDown
          className={cx(
            "size-3.5 shrink-0 text-vetra-muted-fg transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="ml-6 mt-1 space-y-2">{children}</div>}
    </div>
  );
}
