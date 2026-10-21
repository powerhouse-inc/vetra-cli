/**
 * Settings (spec §5.6): name, live address, GitHub, budget and Advanced.
 * Advanced hosts the older deploy views for power users and existing
 * deployments (spec §6.6); it is the only place their technical words show.
 */
import { dispatchActions } from "@powerhousedao/reactor-browser";
import {
  actions as productActions,
  type StudioProductState,
} from "document-models/studio-product";
import { useEffect, useRef, useState } from "react";
import { AgentAuthButton } from "../AgentAuthButton.js";
import { StudioBudgetMeter } from "../budget/BudgetMeter.js";
import { DeploySection } from "../DeploySection.js";
import { githubText } from "../strip/stripModel.js";
import { VersionBadge } from "../VersionBadge.js";
import { WorkspaceExportButton } from "../WorkspaceExportButton.js";

/** Whether a dialog other than `own` is open on the page. */
function otherModalOpen(own: HTMLElement | null): boolean {
  return Array.from(
    window.document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [aria-modal="true"]',
    ),
  ).some((el) => el !== own);
}

export function SettingsDialog({
  product,
  productId,
  onClose,
}: {
  product: StudioProductState | null;
  productId: string | null;
  onClose: () => void;
}) {
  const currentName = product?.name ?? "";
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A modal opened from inside (e.g. in Advanced) closes first.
      if (otherModalOpen(dialogRef.current)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function saveName() {
    const next = name.trim();
    if (!productId || !next || next === currentName) return;
    setSaving(true);
    setError(null);
    const failed = () => setError("Couldn't rename it. Try again.");
    try {
      await dispatchActions(
        productActions.renameProduct({ name: next }),
        productId,
        failed,
      );
    } catch {
      failed();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <header className="flex items-center border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold text-foreground">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            Close
          </button>
        </header>
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-5 py-4 text-sm">
          <section className="flex flex-col gap-1.5">
            <label
              htmlFor="studio-product-name"
              className="font-medium text-foreground"
            >
              Name
            </label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveName();
              }}
            >
              <input
                id="studio-product-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!productId || saving}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-vetra-primary"
              />
              <button
                type="submit"
                disabled={
                  !productId ||
                  saving ||
                  !name.trim() ||
                  name.trim() === currentName
                }
                className="rounded-lg bg-vetra-primary px-3 py-1.5 text-xs font-medium text-vetra-primary-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </form>
            {error ? (
              <span role="alert" className="text-xs text-destructive">
                {error}
              </span>
            ) : null}
          </section>
          <section className="flex flex-col gap-1">
            <h3 className="font-medium text-foreground">Live address</h3>
            <p className="text-muted-foreground">
              {product?.liveUrl ?? "Not live yet"}
            </p>
          </section>
          <section className="flex flex-col gap-1">
            <h3 className="font-medium text-foreground">GitHub</h3>
            <p className="text-muted-foreground">
              {githubText(product?.github.status ?? "NOT_CONNECTED")}
            </p>
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="font-medium text-foreground">Budget</h3>
            <StudioBudgetMeter />
          </section>
          <section className="flex flex-col gap-2 border-t border-border pt-4">
            <button
              type="button"
              aria-expanded={advanced}
              onClick={() => setAdvanced((v) => !v)}
              className="self-start text-sm font-medium text-foreground hover:underline"
            >
              {advanced ? "▾" : "▸"} Advanced
            </button>
            {advanced ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <VersionBadge />
                  <AgentAuthButton />
                  <WorkspaceExportButton />
                </div>
                <div className="rounded-lg border border-border">
                  <DeploySection
                    productName={product?.name ?? "Studio"}
                    onExitToHome={() => setAdvanced(false)}
                  />
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
