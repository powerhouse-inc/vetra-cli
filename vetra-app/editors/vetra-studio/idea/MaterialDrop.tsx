/**
 * Bring your own material to the idea screen (spec §9): drop, paste or pick a
 * diagram, photo or sheet. Wraps the idea box so a drop anywhere on it lands
 * here. Each file is a chip; a sheet shows how many rows it has.
 */
import { useEditorFileDrop } from "@powerhousedao/reactor-browser";
import {
  FileSpreadsheet,
  FileText,
  Image as PictureIcon,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import {
  useEffect,
  useReducer,
  useRef,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import {
  uploadMaterial,
  WorkshopClientError,
  type MaterialCard,
  type MaterialKind,
} from "../hooks/workshop-client.js";
import type { MessageKey } from "../i18n/messages.en.js";
import { useT } from "../i18n/useT.js";
import { materialsReducer, readyCards } from "./materialList.js";

export const MATERIAL_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".heic",
  ".pdf",
  ".xlsx",
  ".csv",
  ".txt",
] as const;

const ERROR_KEYS: Record<string, MessageKey> = {
  "too-large": "material.tooLarge",
  unsupported: "material.unsupported",
  owner: "material.owner",
};

const KIND_ICON: Record<MaterialKind, typeof FileText> = {
  PICTURE: PictureIcon,
  PDF: FileText,
  SHEET: FileSpreadsheet,
  TEXT: FileText,
};

function rowsOf(card: MaterialCard): number {
  return (card.sheets ?? []).reduce((sum, s) => sum + s.rowCount, 0);
}

export type MaterialDropProps = {
  disabled?: boolean;
  /** False when signed out: files are not kept, the chip asks to sign in. */
  signedIn?: boolean;
  /** Called when a signed-out visitor tries to add files. */
  onSignInNeeded?: () => void;
  /** The files that are read and ready, whenever they change. */
  onCards: (cards: MaterialCard[]) => void;
  /** The idea box (or whatever else should accept drops and pastes). */
  children?: ReactNode;
};

export function MaterialDrop({
  disabled = false,
  signedIn = true,
  onSignInNeeded,
  onCards,
  children,
}: MaterialDropProps) {
  const { t } = useT();
  const [items, dispatch] = useReducer(materialsReducer, []);
  const [needSignIn, markNeedSignIn] = useReducer(() => true, false);
  const counter = useRef(0);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    onCards(readyCards(items));
  }, [items]);

  function add(files: File[]) {
    if (disabled || files.length === 0) return;
    if (!signedIn) {
      markNeedSignIn();
      onSignInNeeded?.();
      return;
    }
    for (const file of files) {
      counter.current += 1;
      const key = `m${counter.current}`;
      dispatch({ type: "uploading", key, name: file.name });
      uploadMaterial(file).then(
        (card) => dispatch({ type: "added", key, card }),
        (err: unknown) =>
          dispatch({
            type: "failed",
            key,
            error: err instanceof WorkshopClientError ? err.code : "network",
          }),
      );
    }
  }

  const { dragProps, isDragOver } = useEditorFileDrop({
    accept: MATERIAL_EXTENSIONS,
    onFiles: add,
  });

  function onPaste(e: ClipboardEvent) {
    const pictures = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (pictures.length === 0) return;
    e.preventDefault();
    add(pictures);
  }

  return (
    <div
      {...dragProps}
      onPaste={onPaste}
      className="relative flex w-full flex-col gap-2"
    >
      {children}
      {isDragOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-vetra-primary bg-background/80">
          <p className="text-sm font-medium text-foreground">
            {t("material.dropHere")}
          </p>
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("material.notice")}</p>
      ) : (
        <ul className="flex flex-wrap justify-center gap-2">
          {items.map((item) => {
            const Icon = item.card ? KIND_ICON[item.card.kind] : FileText;
            const failed = item.status === "failed";
            return (
              <li
                key={item.key}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${failed ? "border-destructive text-destructive" : "border-border bg-card text-foreground"}`}
              >
                {item.status === "uploading" ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Icon className="size-3.5" aria-hidden />
                )}
                <span className="max-w-48 truncate">{item.name}</span>
                {item.card?.kind === "SHEET" ? (
                  <span className="text-muted-foreground">
                    {t("material.rows", { rows: rowsOf(item.card) })}
                  </span>
                ) : null}
                {failed ? (
                  <span role="alert">
                    {t(ERROR_KEYS[item.error ?? ""] ?? "material.failed")}
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={t("material.remove", { name: item.name })}
                  onClick={() => dispatch({ type: "remove", key: item.key })}
                  className="rounded-full hover:bg-accent"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {needSignIn ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("material.signIn")}
        </p>
      ) : null}
      <div className="flex justify-center">
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <Plus className="size-3.5" aria-hidden />
          {t("material.add")}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={MATERIAL_EXTENSIONS.join(",")}
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
