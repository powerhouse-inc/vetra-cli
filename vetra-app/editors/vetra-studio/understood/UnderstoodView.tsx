/**
 * "What I understood" (spec §5.2): the draft read out of the customer's
 * material as a picture they can correct before anything is built — the
 * things to keep track of as cards joined by arrows, the steps as one lane,
 * what is still open. Every correction is undoable (Undo, Ctrl/⌘-Z).
 */
import { TriangleAlert, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  addField,
  addRole,
  addStep,
  addThing,
  mergeThings,
  moveStep,
  removeField,
  removeRole,
  removeStep,
  removeThing,
  renameField,
  renameRole,
  renameStep,
  renameThing,
  setFieldType,
  setStepRole,
  splitThing,
  type UnderstoodDraft,
} from "../../../shared/understood-draft.js";
import { useT } from "../i18n/useT.js";
import { LinksLayer } from "./LinksLayer.js";
import { StepsLane } from "./StepsLane.js";
import { ThingCard } from "./ThingCard.js";
import { useDraftEditor } from "./useDraftEditor.js";

export type UnderstoodNote = { materialId: string | null; text: string };

export type UnderstoodViewProps = {
  /** The draft to start from (the view keeps its own edits and undo). */
  draft: UnderstoodDraft;
  /** What could not be read, one row each. */
  notes: readonly UnderstoodNote[];
  /** Every corrected draft, so Back keeps it. */
  onChange: (draft: UnderstoodDraft) => void;
  onBuild: (draft: UnderstoodDraft) => void;
  onBack: () => void;
  busy?: boolean;
};

let idCounter = 0;
/** A fresh id for something added here (not in a reducer: ids are input). */
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

export function UnderstoodView({
  draft: initial,
  notes,
  onChange,
  onBuild,
  onBack,
  busy = false,
}: UnderstoodViewProps) {
  const { t } = useT();
  const { draft, apply, undo, canUndo } = useDraftEditor(initial);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current(draft);
  }, [draft]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      if (e.key.toLowerCase() !== "z" || isTyping(e.target)) return;
      e.preventDefault();
      undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const materialName = (id: string | null) =>
    draft.materials.find((m) => m.id === id)?.name ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-4">
      <header className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">
            {t("understood.heading")}
          </h1>
          {draft.summary ? (
            <p className="max-w-3xl text-sm text-muted-foreground">
              {draft.summary}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Undo2 className="size-4" aria-hidden />
            {t("understood.undo")}
          </button>
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            {t("understood.back")}
          </button>
          <button
            type="button"
            onClick={() => onBuild(draft)}
            disabled={busy || draft.things.length === 0}
            className="rounded-lg bg-vetra-primary px-4 py-1.5 text-sm font-medium text-vetra-primary-fg shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-vetra-primary focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("idea.starting") : t("understood.build")}
          </button>
        </div>
      </header>

      {notes.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {notes.map((n, i) => (
            <li
              key={`${n.materialId ?? ""}-${i}`}
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-1.5 text-xs text-warning"
            >
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {materialName(n.materialId) ? (
                <span className="font-medium">
                  {materialName(n.materialId)}:
                </span>
              ) : null}
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative pt-12">
        <ul
          className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-x-5 gap-y-14"
          // A few cards stay card-sized instead of stretching across.
          style={{ maxWidth: `${Math.max(1, draft.things.length) * 24}rem` }}
        >
          {draft.things.map((thing) => (
            <ThingCard
              key={thing.id}
              thing={thing}
              others={draft.things.filter((x) => x.id !== thing.id)}
              onRename={(name) => apply((d) => renameThing(d, thing.id, name))}
              onRenameField={(fieldId, name) =>
                apply((d) => renameField(d, thing.id, fieldId, name))
              }
              onFieldType={(fieldId, type) =>
                apply((d) => setFieldType(d, thing.id, fieldId, type))
              }
              onAddField={() =>
                apply((d) =>
                  addField(d, thing.id, {
                    id: newId("field"),
                    name: t("understood.newField"),
                    type: "text",
                    options: [],
                    source: null,
                  }),
                )
              }
              onRemoveField={(fieldId) =>
                apply((d) => removeField(d, thing.id, fieldId))
              }
              onMerge={(otherId) =>
                apply((d) => mergeThings(d, thing.id, otherId))
              }
              onSplit={(fieldIds, name) =>
                apply((d) =>
                  splitThing(d, thing.id, fieldIds, newId("thing"), name),
                )
              }
              onRemove={() => apply((d) => removeThing(d, thing.id))}
            />
          ))}
        </ul>
        <LinksLayer links={draft.links} version={draft} />
      </div>
      <button
        type="button"
        onClick={() =>
          apply((d) => addThing(d, newId("thing"), t("understood.newThing")))
        }
        className="self-start rounded-lg border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {t("understood.addThing")}
      </button>

      <StepsLane
        steps={draft.steps}
        roles={draft.roles}
        onMove={(id, to) => apply((d) => moveStep(d, id, to))}
        onRename={(id, name) => apply((d) => renameStep(d, id, name))}
        onRole={(id, roleId) => apply((d) => setStepRole(d, id, roleId))}
        onAdd={() =>
          apply((d) =>
            addStep(d, {
              id: newId("step"),
              name: t("understood.newStep"),
              roleId: null,
              thingId: null,
            }),
          )
        }
        onRemove={(id) => apply((d) => removeStep(d, id))}
        onRenameRole={(id, name) => apply((d) => renameRole(d, id, name))}
        onAddRole={() =>
          apply((d) => addRole(d, newId("role"), t("understood.newRole")))
        }
        onRemoveRole={(id) => apply((d) => removeRole(d, id))}
      />

      {draft.questions.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">
            {t("understood.stillOpen")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {draft.questions.map((q, i) => (
              <li
                key={i}
                className="rounded-lg border border-border bg-card px-3 py-1 text-xs text-foreground"
              >
                {q}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
