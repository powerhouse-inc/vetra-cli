/**
 * The steps as one lane of numbered chips, left to right, with who does
 * each step under it. Reorder by dragging, with the ← / → buttons, or with
 * the arrow keys on a focused chip. The roles ("Who") sit above the lane.
 */
import { ArrowLeft, ArrowRight, ChevronRight, User, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { DraftRole, DraftStep } from "../../../shared/understood-draft.js";
import { useT } from "../i18n/useT.js";
import { InlineName } from "./ThingCard.js";

export type StepsLaneProps = {
  steps: DraftStep[];
  roles: DraftRole[];
  onMove: (stepId: string, toIndex: number) => void;
  onRename: (stepId: string, name: string) => void;
  onRole: (stepId: string, roleId: string | null) => void;
  onAdd: () => void;
  onRemove: (stepId: string) => void;
  onRenameRole: (roleId: string, name: string) => void;
  onAddRole: () => void;
  onRemoveRole: (roleId: string) => void;
};

export function StepsLane({
  steps,
  roles,
  onMove,
  onRename,
  onRole,
  onAdd,
  onRemove,
  onRenameRole,
  onAddRole,
  onRemoveRole,
}: StepsLaneProps) {
  const { t } = useT();
  const [dragging, setDragging] = useState<string | null>(null);

  function onChipKey(e: KeyboardEvent<HTMLLIElement>, index: number) {
    if (e.target !== e.currentTarget) return;
    const id = steps[index].id;
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      onMove(id, index - 1);
    } else if (e.key === "ArrowRight" && index < steps.length - 1) {
      e.preventDefault();
      onMove(id, index + 1);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-foreground">
          {t("understood.steps")}
        </h2>
        <span className="text-xs text-muted-foreground">
          {t("understood.who")}:
        </span>
        <ul className="flex flex-wrap items-center gap-1.5">
          {roles.map((r) => (
            <li
              key={r.id}
              className="group inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-foreground"
            >
              <User className="size-3 text-vetra-primary" aria-hidden />
              <InlineName
                value={r.name}
                onRename={(name) => onRenameRole(r.id, name)}
              />
              <button
                type="button"
                aria-label={t("understood.removeRole", { name: r.name })}
                onClick={() => onRemoveRole(r.id)}
                className="rounded-full text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={onAddRole}
              className="rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t("understood.addRole")}
            </button>
          </li>
        </ul>
      </div>
      <ol className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {steps.map((s, i) => (
          <li
            key={s.id}
            data-step-id={s.id}
            tabIndex={0}
            draggable
            onKeyDown={(e) => onChipKey(e, i)}
            onDragStart={(e) => {
              setDragging(s.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              if (dragging) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && dragging !== s.id) onMove(dragging, i);
              setDragging(null);
            }}
            className={`group flex shrink-0 items-center gap-1 focus:outline-none ${dragging === s.id ? "opacity-50" : ""}`}
          >
            <div className="flex min-w-36 max-w-56 cursor-grab flex-col gap-1 rounded-xl border border-border bg-card px-2.5 py-1.5 shadow-sm group-focus:ring-2 group-focus:ring-vetra-primary">
              <div className="flex items-center gap-1.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-vetra-primary text-[11px] font-semibold text-vetra-primary-fg">
                  {i + 1}
                </span>
                <InlineName
                  value={s.name}
                  onRename={(name) => onRename(s.id, name)}
                  className="flex-1 text-xs font-medium text-foreground"
                />
                <button
                  type="button"
                  aria-label={t("understood.removeStep", { name: s.name })}
                  onClick={() => onRemove(s.id)}
                  className="shrink-0 rounded text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
              <div className="flex items-center gap-0.5">
                <select
                  value={s.roleId ?? ""}
                  aria-label={t("understood.roleOf", { name: s.name })}
                  onChange={(e) => onRole(s.id, e.target.value || null)}
                  className="min-w-0 flex-1 cursor-pointer appearance-none truncate rounded bg-transparent px-0.5 text-[11px] text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-vetra-primary"
                >
                  <option value="">{t("understood.noRole")}</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={t("understood.moveEarlier", { name: s.name })}
                  disabled={i === 0}
                  onClick={() => onMove(s.id, i - 1)}
                  className="rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowLeft className="size-3" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t("understood.moveLater", { name: s.name })}
                  disabled={i === steps.length - 1}
                  onClick={() => onMove(s.id, i + 1)}
                  className="rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowRight className="size-3" aria-hidden />
                </button>
              </div>
            </div>
            {i < steps.length - 1 ? (
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </li>
        ))}
        <li className="flex shrink-0 items-center pl-1">
          <button
            type="button"
            onClick={onAdd}
            className="rounded-xl border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {t("understood.addStep")}
          </button>
        </li>
      </ol>
    </section>
  );
}
