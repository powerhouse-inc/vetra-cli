/**
 * The Versions panel (spec §5.7, G7), opened from `Version <n> ▾` in the
 * live strip: every launch with its title, time and who made it, "What
 * changed", and **Go back** — or, when the product's data can't go back
 * (D6, Ruling F26), the reason and **Undo with the agent**. The unhealthy
 * banner's "Go back to Version N-1" uses the same confirmation and checks.
 */
import type { StudioProductState } from "document-models/studio-product";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { startChange } from "../change/startChange.js";
import type { StartProductDrive } from "../idea/startProduct.js";
import {
  GO_BACK,
  UNDO_WITH_THE_AGENT,
  VERSIONS,
  WHAT_CHANGED,
  failedGoBack,
  goBackConfirmText,
  goBackDisabledReason,
  undoRequest,
  versionRows,
  type VersionRow,
} from "./versionRows.js";

const ACTION_FAILED = "Couldn't do that. Try again.";
/** While Undo with the agent is being started. */
const ACTION_BUSY = "Asking the agent…";

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : ACTION_FAILED;
}

/** Runs `run`, tracking busy and a plain error. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perform = useCallback(
    async (run: () => void | Promise<void>, onDone?: () => void) => {
      setError(null);
      setBusy(true);
      try {
        await run();
        onDone?.();
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  return { busy, error, perform };
}

/** Closes on Escape unless something inside handled it first. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

const PILL =
  "rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";

function Overlay({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`flex max-h-full w-full ${wide ? "max-w-2xl" : "max-w-md"} flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Go back to Version `target`: the confirmation, or — when the checks say
 * it can't happen now — why, with Undo with the agent for a blocked version.
 */
export function GoBackConfirm({
  product,
  target,
  onConfirm,
  onUndo,
  onCancel,
}: {
  /** Normalised product state. */
  product: StudioProductState;
  target: number;
  /** REQUEST_ROLLBACK to `target`; rejects with a plain message. */
  onConfirm: (target: number) => void | Promise<void>;
  /** Starts the UNDO change for a version's title. */
  onUndo: (title: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { busy, error, perform } = useAction();
  useEscape(onCancel);
  const version = product.versions.find((v) => v.number === target);
  const live = product.liveVersion;
  const disabled = goBackDisabledReason(product);
  const row = versionRows(product, new Date()).find((r) => r.number === target);

  let body: ReactNode;
  let action: ReactNode = null;
  if (disabled) {
    body = disabled;
  } else if (row?.action === "undo-with-agent" && version) {
    body = row.blockedReason;
    action = (
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void perform(() => onUndo(row.undoTitle ?? version.title), onCancel)
        }
        className={PILL}
      >
        {UNDO_WITH_THE_AGENT}
      </button>
    );
  } else if (row?.action === "go-back" && live != null) {
    body = goBackConfirmText(target, live);
    action = (
      <button
        type="button"
        disabled={busy}
        onClick={() => void perform(() => onConfirm(target), onCancel)}
        className="rounded-full bg-vetra-primary px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {GO_BACK}
      </button>
    );
  } else {
    body = `Version ${target} can't be made live again.`;
  }

  return (
    <Overlay label={`Go back to Version ${target}`}>
      <div data-confirm="go-back" className="px-5 py-4 text-sm text-foreground">
        <p>{body}</p>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={PILL}>
            Cancel
          </button>
          {action}
        </div>
      </div>
    </Overlay>
  );
}

function VersionItem({
  row,
  disabled,
  onGoBack,
  onUndo,
}: {
  row: VersionRow;
  /** Why the buttons can't be pressed now (E6 etc.), or null. */
  disabled: string | null;
  onGoBack: (number: number) => void;
  onUndo: (row: VersionRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const changed = row.whatChanged;
  const hasDetail =
    !!changed.summary || changed.files.length > 0 || !!changed.commitUrl;
  return (
    <li
      data-version={row.number}
      data-live={row.live ? "true" : undefined}
      className="border-b border-border px-5 py-3 last:border-b-0"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 w-3 shrink-0 text-xs ${row.live ? "text-success" : "text-transparent"}`}
        >
          ●
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">
            <span className="font-semibold">Version {row.number}</span>{" "}
            <span>{row.title}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.live ? "Live · " : ""}
            {row.when} · {row.who}
          </p>
          {row.blockedReason ? (
            <p data-blocked className="mt-1.5 text-xs text-foreground">
              {row.blockedReason}
            </p>
          ) : null}
          {hasDetail ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="mt-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {open ? "▾" : "▸"} {WHAT_CHANGED}
            </button>
          ) : null}
          {open ? (
            <div className="mt-1.5 space-y-1.5 text-xs text-foreground">
              {changed.summary ? <p>{changed.summary}</p> : null}
              {changed.files.length > 0 ? (
                <ul className="list-inside list-disc text-muted-foreground">
                  {changed.files.map((f) => (
                    <li key={f} className="truncate">
                      {f}
                    </li>
                  ))}
                </ul>
              ) : null}
              {changed.commitUrl ? (
                <a
                  href={changed.commitUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-vetra-primary hover:underline"
                >
                  See it on GitHub ↗
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
        {row.action === "go-back" ? (
          <button
            type="button"
            disabled={disabled !== null}
            title={disabled ?? undefined}
            onClick={() => onGoBack(row.number)}
            className={`${PILL} shrink-0`}
          >
            {GO_BACK}
          </button>
        ) : row.action === "undo-with-agent" ? (
          <button
            type="button"
            disabled={disabled !== null}
            title={disabled ?? undefined}
            onClick={() => onUndo(row)}
            className={`${PILL} shrink-0`}
          >
            {UNDO_WITH_THE_AGENT}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function VersionsPanel({
  product,
  now,
  onGoBack,
  onUndo,
  onClose,
}: {
  /** Normalised product state. */
  product: StudioProductState;
  now: Date;
  /** Opens the Go back confirmation for a version. */
  onGoBack: (number: number) => void;
  /** Starts the UNDO change for a version's title. */
  onUndo: (title: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const { busy, error, perform } = useAction();
  useEscape(onClose);
  const rows = versionRows(product, now);
  const disabled = busy ? ACTION_BUSY : goBackDisabledReason(product);
  const failed = failedGoBack(product);
  return (
    <Overlay label={VERSIONS} wide>
      <header className="flex items-center border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold text-foreground">{VERSIONS}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          ✕
        </button>
      </header>
      {disabled || failed || error ? (
        <div
          role="status"
          className="space-y-1 border-b border-border bg-muted/40 px-5 py-2 text-xs text-foreground"
        >
          {disabled ? <p data-disabled-reason>{disabled}</p> : null}
          {failed && failed !== disabled ? <p>{failed}</p> : null}
          {error ? <p className="text-destructive">{error}</p> : null}
        </div>
      ) : null}
      <ol className="min-h-0 overflow-y-auto">
        {rows.map((row) => (
          <VersionItem
            key={row.number}
            row={row}
            disabled={disabled}
            onGoBack={onGoBack}
            onUndo={(r) =>
              void perform(() => onUndo(r.undoTitle ?? r.title), onClose)
            }
          />
        ))}
      </ol>
    </Overlay>
  );
}

/**
 * The panel and the Go back confirmation, bound to the product. The shell
 * opens the panel from the strip and routes every Go back (the banner's
 * too) through `confirmGoBack`.
 */
export function useVersionsPanel({
  product,
  productId,
  drive,
  now,
  requestRollback,
}: {
  product: StudioProductState | null;
  productId: string | null;
  /** The Studio drive (Undo with the agent starts its conversation there). */
  drive: StartProductDrive;
  now: Date;
  /** REQUEST_ROLLBACK (`useFailureHandlers().requestRollback`). */
  requestRollback: (versionNumber: number) => void | Promise<void>;
}): {
  openPanel: () => void;
  confirmGoBack: (versionNumber: number) => void;
  element: ReactNode;
} {
  const [panelOpen, setPanelOpen] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  // The latest handler, so `confirmGoBack` stays stable for the failures.
  const rollback = useRef(requestRollback);
  rollback.current = requestRollback;

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const confirmGoBack = useCallback((n: number) => setTarget(n), []);
  const cancel = useCallback(() => setTarget(null), []);
  const undo = useCallback(
    async (title: string) => {
      if (!productId) throw new Error(ACTION_FAILED);
      await startChange({
        drive,
        productId,
        request: undoRequest(title),
        kind: "UNDO",
      });
      setPanelOpen(false);
    },
    [drive, productId],
  );

  const element = product ? (
    <>
      {panelOpen && target === null ? (
        <VersionsPanel
          product={product}
          now={now}
          onGoBack={confirmGoBack}
          onUndo={undo}
          onClose={closePanel}
        />
      ) : null}
      {target !== null ? (
        <GoBackConfirm
          product={product}
          target={target}
          onConfirm={async (n) => {
            await rollback.current(n);
            setPanelOpen(false);
          }}
          onUndo={undo}
          onCancel={cancel}
        />
      ) : null}
    </>
  ) : null;

  return { openPanel, confirmGoBack, element };
}
