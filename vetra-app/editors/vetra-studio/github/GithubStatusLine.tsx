/**
 * The one GitHub line the customer sees (spec §5.6, default Q1): where their
 * code is saved, with the one action that fits the current state. It never
 * appears before the product's first launch; Settings and the live strip
 * render this same component.
 *
 * The product document is written by the Studio's agent and mirror (Tasks
 * 2.10/4.4); this line only opens the connect dialog or asks for the existing
 * mirror / bring-in requests.
 */
import { dispatchActions } from "@powerhousedao/reactor-browser";
import {
  actions as productActions,
  BRING_IN_REQUEST,
  type StudioProductState,
} from "document-models/studio-product";
import { useState } from "react";
import { startChange } from "../change/startChange.js";
import type { StartProductDrive } from "../idea/startProduct.js";
import { ConnectGithubDialog } from "./ConnectGithubDialog.js";

export const NOT_CONNECTED_LINE = "Code saved in your Studio · Connect GitHub";
export const CONNECTED_LINE = "GitHub ✓";
export const DISCONNECTED_LINE =
  "GitHub disconnected — your code is still saved in the Studio.";
export const EXTERNAL_CHANGES_LINE =
  "There are changes on GitHub that aren't in your Studio";

/** "Couldn't save to GitHub (<reason>). Will retry with the next launch."
 * (the same sentence the agent logs, Task 4.4). */
export function pushFailedText(reason: string | null): string {
  const plain = reason?.trim().replace(/[.\s]+$/, "") ?? "";
  return plain
    ? `Couldn't save to GitHub (${plain}). Will retry with the next launch.`
    : "Couldn't save to GitHub. Will retry with the next launch.";
}

const ACTION =
  "rounded px-1 font-medium text-vetra-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50";

export function GithubStatusLine({
  product,
  productId,
  drive,
  requestedBy = "you",
  className,
}: {
  /** The product state; nothing renders until it has a live version. */
  product: StudioProductState | null;
  /** The product document, for the mirror request. */
  productId: string | null;
  /** The Studio's drive, for Bring them in (the existing change path). */
  drive?: StartProductDrive;
  /** Who asks for the mirror ("you" until the Studio knows a name). */
  requestedBy?: string;
  className?: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bringing, setBringing] = useState(false);

  // Never before the first launch (default Q1): no prompt, no badge.
  if (!product || product.liveVersion == null) return null;

  const { github } = product;
  const hasExternalChanges =
    github.status === "CONNECTED" && github.externalChangesSha != null;

  async function bringIn() {
    setError(null);
    if (!productId || !drive) {
      setError("Your product is still loading. Try again in a moment.");
      return;
    }
    setBringing(true);
    try {
      await startChange({
        drive,
        productId,
        request: BRING_IN_REQUEST,
        kind: "CHANGE",
      });
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't bring them in. Try again.",
      );
    } finally {
      setBringing(false);
    }
  }

  function retryNow() {
    if (!productId) return;
    const failed = () => setError("Couldn't ask again. Try again.");
    dispatchActions(
      productActions.requestMirror({
        requestedAt: new Date().toISOString(),
        requestedBy,
      }),
      productId,
      failed,
    ).catch(failed);
  }

  return (
    <>
      <span className={className}>
        {github.status === "NOT_CONNECTED" ? (
          <>
            Code saved in your Studio ·{" "}
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className={ACTION}
            >
              Connect GitHub
            </button>
          </>
        ) : github.status === "DISCONNECTED" ? (
          <>
            {DISCONNECTED_LINE}{" "}
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className={ACTION}
            >
              Reconnect
            </button>
          </>
        ) : github.status === "PUSH_FAILED" ? (
          <>
            {pushFailedText(github.lastError ?? null)}{" "}
            <button type="button" onClick={retryNow} className={ACTION}>
              Retry now
            </button>
          </>
        ) : hasExternalChanges ? (
          <>
            {EXTERNAL_CHANGES_LINE}{" "}
            <button
              type="button"
              disabled={bringing}
              onClick={() => void bringIn()}
              className={ACTION}
            >
              Bring them in
            </button>
          </>
        ) : (
          CONNECTED_LINE
        )}
        {error ? (
          <span role="alert" className="ml-1 text-destructive">
            {" "}
            {error}
          </span>
        ) : null}
      </span>
      {dialogOpen ? (
        <ConnectGithubDialog
          appId={product.appId ?? null}
          productName={product.name ?? ""}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
}
