/**
 * The live product's page (spec §5.6–§5.7): the live app filling the page
 * with the "Change something" bubble; while a change is open, the Live |
 * Preview split with the Ready bar over the preview. The change drawer sits
 * on the right of both and stays open across the switch, so after Make it
 * live it can say "Version <n> is live." as the split closes.
 */
import type { PHDocument } from "document-model";
import type { StudioProductState } from "document-models/studio-product";
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { Failure } from "../failures/failureStates.js";
import type { StartProductDrive } from "../idea/startProduct.js";
import { LiveEmbed } from "../live/LiveEmbed.js";
import { ProductView } from "../live/ProductView.js";
import { openChange } from "../strip/stripModel.js";
import { ChangeBubble, ChangeDrawer } from "./ChangeDrawer.js";
import { OPEN_LIVE_APP, liveUnchanged } from "./changeCopy.js";
import { ReadyBar } from "./ReadyBar.js";
import { SplitView } from "./SplitView.js";
import { startChange } from "./startChange.js";

export function LiveSurface({
  product,
  productId,
  drive,
  documents,
  failure,
  now,
  story,
  preview,
  requestedBy,
  onOpenAccess,
}: {
  /** Normalised product state with a live version (`readProduct`). */
  product: StudioProductState;
  productId: string | null;
  drive: StartProductDrive;
  documents: readonly PHDocument[];
  /** The live failure to show above the app (state 2 only; the change's
   *  story shows its own). */
  failure: Failure | null;
  now: Date;
  /** The open change's story; null when no change is open. */
  story: ReactNode | null;
  /** The preview of the open change. */
  preview: ReactNode;
  requestedBy: string;
  onOpenAccess: () => void;
}) {
  const change = openChange(product);
  const openId = change?.id ?? null;
  const [drawerOpen, setDrawerOpen] = useState(openId !== null);
  const [launched, setLaunched] = useState<number | null>(null);
  // "Keep changing" puts the Ready bar away for this READY state.
  const [keptChanging, setKeptChanging] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  // The open change moved on (adjusted while rendering, not in an effect).
  const [seenOpenId, setSeenOpenId] = useState(openId);
  if (openId !== seenOpenId) {
    setSeenOpenId(openId);
    if (openId !== null) {
      setLaunched(null);
      setDrawerOpen(true);
    } else if (seenOpenId !== null) {
      const live = product.versions.find(
        (v) => v.number === product.liveVersion,
      );
      if (live?.changeId === seenOpenId) {
        setLaunched(live.number);
        setDrawerOpen(true);
      }
    }
  }

  const onStart = useCallback(
    (request: string) =>
      productId
        ? startChange({ drive, productId, request, kind: "CHANGE" })
        : Promise.reject(new Error("Your product is still loading.")),
    [drive, productId],
  );

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setLaunched(null);
  }, []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);

  const readyKey = change
    ? `${change.id}:${change.metrics.readyAt ?? ""}`
    : null;
  const keepChanging = useCallback(() => {
    setKeptChanging(readyKey);
    setDrawerOpen(true);
    // The story's box takes the next request into the same change.
    setTimeout(() => {
      drawerRef.current
        ?.querySelector<HTMLInputElement>('input[aria-label="Steer it"]')
        ?.focus();
    }, 0);
  }, [readyKey]);

  const version = product.liveVersion;
  if (version === null || version === undefined || !product.liveUrl) {
    return null;
  }

  const drawer = drawerOpen ? (
    <ChangeDrawer
      product={product}
      story={change ? story : null}
      launchedVersion={change ? null : launched}
      onStart={onStart}
      onClose={closeDrawer}
      containerRef={drawerRef}
    />
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {change ? (
          <SplitView
            live={
              <LiveEmbed
                liveUrl={product.liveUrl}
                version={version}
                fallbackLabel={OPEN_LIVE_APP}
                preview={
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    {liveUnchanged(version)}
                  </p>
                }
              />
            }
            preview={preview}
            bar={
              keptChanging === readyKey && change.status === "READY" ? null : (
                <ReadyBar
                  product={product}
                  productId={productId}
                  change={change}
                  requestedBy={requestedBy}
                  onKeepChanging={keepChanging}
                />
              )
            }
          />
        ) : (
          <ProductView
            product={product}
            studioId={drive.header.id}
            documents={documents}
            failure={failure}
            now={now}
            onOpenAccess={onOpenAccess}
            onChangeSomething={drawerOpen ? undefined : openDrawer}
          />
        )}
        {change && !drawerOpen ? <ChangeBubble onOpen={openDrawer} /> : null}
      </div>
      {drawer}
    </div>
  );
}
