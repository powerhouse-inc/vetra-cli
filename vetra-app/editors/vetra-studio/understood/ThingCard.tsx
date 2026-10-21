/**
 * One thing to keep track of, as a card: its name (click to rename), a row
 * per field (`name · kind`, where a field came from a sheet), and a small
 * menu to merge it with another card, split some fields off, or remove it.
 */
import {
  Calendar,
  Camera,
  Ellipsis,
  Hash,
  List,
  MapPin,
  SquareCheck,
  Type,
  User,
  X,
} from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import {
  DRAFT_FIELD_TYPES,
  fieldSources,
  type DraftField,
  type DraftFieldType,
  type DraftThing,
} from "../../../shared/understood-draft.js";
import type { MessageKey } from "../i18n/messages.en.js";
import { useT } from "../i18n/useT.js";

export const FIELD_TYPE_KEYS: Record<DraftFieldType, MessageKey> = {
  text: "understood.type.text",
  number: "understood.type.number",
  date: "understood.type.date",
  "yes-no": "understood.type.yes-no",
  choice: "understood.type.choice",
  person: "understood.type.person",
  photo: "understood.type.photo",
  place: "understood.type.place",
};

const FIELD_ICON: Record<DraftFieldType, typeof Type> = {
  text: Type,
  number: Hash,
  date: Calendar,
  "yes-no": SquareCheck,
  choice: List,
  person: User,
  photo: Camera,
  place: MapPin,
};

/** A name shown as text; a click turns it into an input (Enter keeps,
 *  Escape cancels, leaving the box keeps). */
export function InlineName({
  value,
  onRename,
  className = "",
  label,
}: {
  value: string;
  onRename: (name: string) => void;
  className?: string;
  /** The input's accessible name while editing (defaults to the value). */
  label?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (editing === null) {
    return (
      <button
        type="button"
        onClick={() => setEditing(value)}
        className={`min-w-0 truncate rounded px-0.5 text-left hover:bg-accent focus:outline-none focus:ring-2 focus:ring-vetra-primary ${className}`}
      >
        {value}
      </button>
    );
  }
  function commit() {
    const name = (editing ?? "").trim();
    setEditing(null);
    if (name && name !== value) onRename(name);
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
    }
  }
  return (
    <input
      autoFocus
      value={editing}
      aria-label={label ?? value}
      onChange={(e) => setEditing(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
      className={`min-w-0 rounded border border-vetra-primary bg-background px-0.5 text-foreground focus:outline-none ${className}`}
    />
  );
}

export type ThingCardProps = {
  thing: DraftThing;
  /** The other cards, to merge with. */
  others: DraftThing[];
  onRename: (name: string) => void;
  onRenameField: (fieldId: string, name: string) => void;
  onFieldType: (fieldId: string, type: DraftFieldType) => void;
  onAddField: () => void;
  onRemoveField: (fieldId: string) => void;
  onMerge: (otherId: string) => void;
  onSplit: (fieldIds: string[], name: string) => void;
  onRemove: () => void;
};

type Menu = null | "menu" | "merge" | "split";

export function ThingCard({
  thing,
  others,
  onRename,
  onRenameField,
  onFieldType,
  onAddField,
  onRemoveField,
  onMerge,
  onSplit,
  onRemove,
}: ThingCardProps) {
  const { t } = useT();
  const [menu, setMenu] = useState<Menu>(null);
  return (
    <li
      data-thing-id={thing.id}
      className="relative flex min-w-0 flex-col rounded-xl border border-border bg-card shadow-sm"
    >
      <div className="flex items-center gap-1 rounded-t-xl border-b border-border bg-vetra-primary/10 px-3 py-1.5">
        <InlineName
          value={thing.name}
          onRename={onRename}
          className="flex-1 text-base font-semibold text-foreground"
        />
        <button
          type="button"
          aria-label={t("understood.menu", { name: thing.name })}
          aria-expanded={menu !== null}
          onClick={() => setMenu(menu === null ? "menu" : null)}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Ellipsis className="size-4" aria-hidden />
        </button>
      </div>
      {menu !== null ? (
        <CardMenu
          menu={menu}
          thing={thing}
          others={others}
          onMenu={setMenu}
          onMerge={(id) => {
            setMenu(null);
            onMerge(id);
          }}
          onSplit={(ids, name) => {
            setMenu(null);
            onSplit(ids, name);
          }}
          onRemove={() => {
            setMenu(null);
            onRemove();
          }}
        />
      ) : null}
      <ul className="flex flex-col px-1.5 py-1">
        {thing.fields.map((f) => (
          <FieldRow
            key={f.id}
            field={f}
            onRename={(name) => onRenameField(f.id, name)}
            onType={(type) => onFieldType(f.id, type)}
            onRemove={() => onRemoveField(f.id)}
          />
        ))}
      </ul>
      <button
        type="button"
        onClick={onAddField}
        className="mx-1.5 mb-1.5 self-start rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {t("understood.addField")}
      </button>
    </li>
  );
}

function FieldRow({
  field,
  onRename,
  onType,
  onRemove,
}: {
  field: DraftField;
  onRename: (name: string) => void;
  onType: (type: DraftFieldType) => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const Icon = FIELD_ICON[field.type];
  const sheets = fieldSources(field)
    .map((s) => s.sheet)
    .filter((s): s is string => s !== null);
  return (
    <li className="group flex h-7 min-w-0 items-center gap-1.5 rounded px-1 text-[13px] hover:bg-accent/60">
      <Icon className="size-3.5 shrink-0 text-vetra-primary" aria-hidden />
      <InlineName
        value={field.name}
        onRename={onRename}
        className="max-w-[62%] shrink-0 text-foreground"
      />
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <select
        value={field.type}
        aria-label={t("understood.typeOf", { name: field.name })}
        onChange={(e) => {
          const type = DRAFT_FIELD_TYPES.find((x) => x === e.target.value);
          if (type) onType(type);
        }}
        className="field-sizing-content min-w-0 shrink-0 cursor-pointer appearance-none rounded bg-transparent px-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-vetra-primary"
      >
        {DRAFT_FIELD_TYPES.map((type) => (
          <option key={type} value={type}>
            {t(FIELD_TYPE_KEYS[type])}
          </option>
        ))}
      </select>
      <span className="flex-1" />
      {sheets[0] ? (
        <span
          title={sheets.join(", ")}
          className="min-w-0 max-w-28 shrink-[10] truncate rounded bg-muted px-1 text-[10px] text-muted-foreground"
        >
          {t("understood.from", { sheet: sheets[0] })}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={t("understood.removeField", { name: field.name })}
        onClick={onRemove}
        className="shrink-0 rounded text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

const MENU_ITEM =
  "w-full rounded px-2 py-1 text-left text-xs text-foreground hover:bg-accent";

function CardMenu({
  menu,
  thing,
  others,
  onMenu,
  onMerge,
  onSplit,
  onRemove,
}: {
  menu: Exclude<Menu, null>;
  thing: DraftThing;
  others: DraftThing[];
  onMenu: (menu: Menu) => void;
  onMerge: (otherId: string) => void;
  onSplit: (fieldIds: string[], name: string) => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const [chosen, setChosen] = useState<string[]>([]);
  const [name, setName] = useState(() => t("understood.newThing"));
  return (
    <div
      role="menu"
      className="absolute right-1 top-9 z-20 flex w-56 flex-col gap-0.5 rounded-lg border border-border bg-card p-1 shadow-lg"
    >
      {menu === "menu" ? (
        <>
          <button
            type="button"
            role="menuitem"
            disabled={others.length === 0}
            onClick={() => onMenu("merge")}
            className={`${MENU_ITEM} disabled:opacity-50`}
          >
            {t("understood.merge")}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={thing.fields.length < 2}
            onClick={() => onMenu("split")}
            className={`${MENU_ITEM} disabled:opacity-50`}
          >
            {t("understood.split")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onRemove}
            className={`${MENU_ITEM} text-destructive`}
          >
            {t("understood.remove")}
          </button>
        </>
      ) : null}
      {menu === "merge"
        ? others.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitem"
              onClick={() => onMerge(o.id)}
              className={MENU_ITEM}
            >
              {o.name}
            </button>
          ))
        : null}
      {menu === "split" ? (
        <div className="flex flex-col gap-1 p-1">
          <ul className="flex max-h-40 flex-col overflow-y-auto">
            {thing.fields.map((f) => (
              <li key={f.id}>
                <label className="flex items-center gap-1.5 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={chosen.includes(f.id)}
                    onChange={(e) =>
                      setChosen(
                        e.target.checked
                          ? [...chosen, f.id]
                          : chosen.filter((x) => x !== f.id),
                      )
                    }
                  />
                  {f.name}
                </label>
              </li>
            ))}
          </ul>
          <input
            value={name}
            aria-label={t("understood.splitName")}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-vetra-primary"
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => onMenu(null)}
              className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
            >
              {t("understood.cancel")}
            </button>
            <button
              type="button"
              disabled={
                chosen.length === 0 ||
                chosen.length === thing.fields.length ||
                !name.trim()
              }
              onClick={() => onSplit(chosen, name.trim())}
              className="rounded bg-vetra-primary px-2 py-0.5 text-xs font-medium text-vetra-primary-fg disabled:opacity-50"
            >
              {t("understood.splitOff")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
