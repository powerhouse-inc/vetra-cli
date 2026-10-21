/**
 * State 2 (spec §5.6): the product once it is live and no change is open —
 * the live app filling the page under the step strip, with the arrival
 * banner, when something is wrong the one failure row that says what, and
 * the "Change something" bubble that opens the change drawer (Task 3.5's
 * LiveSurface; while a change is open it shows the Live | Preview split).
 */
import { isChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import { useDocumentSafe, usePHToast } from "@powerhousedao/reactor-browser";
import type { PHDocument } from "document-model";
import { useEffect, useState, type ReactNode } from "react";
import type {
  Change,
  StudioProductState,
} from "document-models/studio-product";
import { ChangeBubble } from "../change/ChangeDrawer.js";
import { FailureLine } from "../failures/FailureLine.js";
import type { Failure } from "../failures/failureStates.js";
import {
  listImports,
  runImport,
  type ImportOffer,
} from "../hooks/workshop-client.js";
import { useT } from "../i18n/useT.js";
import { PreviewPane } from "../preview/PreviewPane.js";
import { LiveBanner } from "./LiveBanner.js";
import { LiveEmbed } from "./LiveEmbed.js";
import { RowImportCard } from "./RowImportCard.js";

export function ProductView({
  product,
  studioId,
  documents,
  failure,
  now,
  onOpenAccess,
  onChangeSomething,
  suggestions,
}: {
  /** Normalised product state with a live version (`readProduct`). */
  product: StudioProductState;
  /** The Studio (its drive): scopes the one-time banner. */
  studioId: string;
  /** The drive's documents; the preview's own screens come from them. */
  documents: readonly PHDocument[];
  /** The live failure to show above the app (launch, permission, health). */
  failure: Failure | null;
  now: Date;
  onOpenAccess: () => void;
  /** Opens the change drawer; no bubble while it is open. */
  onChangeSomething?: () => void;
  /** The "Make it better" card (spec §5.8), under the banner. */
  suggestions?: ReactNode;
}) {
  const version = product.liveVersion;
  const live =
    version === undefined || version === null
      ? undefined
      : product.versions.find((v) => v.number === version);
  const change: Change | null =
    (live?.changeId
      ? product.changes.find((c) => c.id === live.changeId)
      : undefined) ?? null;
  // D12's fallback: the same preview pane the build surface shows, on the
  // live version's conversation.
  const sessionState = useDocumentSafe(change?.chatSessionId ?? null);
  const session =
    sessionState.status === "success" &&
    isChatSessionDocument(sessionState.data)
      ? sessionState.data
      : undefined;
  const toast = usePHToast();
  const { t } = useT();
  const [offers, setOffers] = useState<ImportOffer[]>([]);

  useEffect(() => {
    let live = true;
    listImports()
      .then((next) => {
        if (live) setOffers(next);
      })
      .catch(() => {
        // No reactor or no imports: the card simply stays away.
      });
    return () => {
      live = false;
    };
  }, [product.productDriveId]);

  const offer = offers.find((o) => o.done < o.rows);

  async function bringRows(
    file: string,
  ): Promise<{ imported: number; failed: number }> {
    const result = await runImport(file);
    const next = await listImports().catch(() => offers);
    setOffers(next);
    if (!result.failed && result.imported > 0) {
      toast?.(
        t("rowImport.done", {
          rows: result.imported,
          product: product.name ?? "",
        }),
      );
    }
    return result;
  }

  if (version === undefined || version === null || !product.liveUrl) {
    return null;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <LiveBanner
        studioId={studioId}
        version={version}
        liveSince={product.liveSince ?? null}
        liveUrl={product.liveUrl}
        now={now}
        onOpenAccess={onOpenAccess}
      />
      {failure ? (
        <div className="shrink-0 px-4 pb-3">
          <FailureLine failure={failure} />
        </div>
      ) : null}
      {suggestions}
      {offer ? <RowImportCard offer={offer} onRun={bringRows} /> : null}
      <LiveEmbed
        liveUrl={product.liveUrl}
        version={version}
        preview={
          <PreviewPane
            change={change}
            documents={documents}
            session={session}
          />
        }
      />
      {onChangeSomething ? <ChangeBubble onOpen={onChangeSomething} /> : null}
    </div>
  );
}
