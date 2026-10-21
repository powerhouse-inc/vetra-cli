/**
 * State 2 (spec §5.6): the product once it is live and no change is open —
 * the live app filling the page under the step strip, with the arrival
 * banner and, when something is wrong, the one failure row that says what.
 * While a change is open the page keeps the build surface (Task 2.9; the
 * Live | Preview split is Task 3.5).
 */
import { isChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import { useDocumentSafe } from "@powerhousedao/reactor-browser";
import type { PHDocument } from "document-model";
import type {
  Change,
  StudioProductState,
} from "document-models/studio-product";
import { FailureLine } from "../failures/FailureLine.js";
import type { Failure } from "../failures/failureStates.js";
import { PreviewPane } from "../preview/PreviewPane.js";
import { LiveBanner } from "./LiveBanner.js";
import { LiveEmbed } from "./LiveEmbed.js";

export function ProductView({
  product,
  studioId,
  documents,
  failure,
  now,
  onOpenAccess,
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

  if (version === undefined || version === null || !product.liveUrl) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
    </div>
  );
}
