/**
 * The Studio page (spec §5.1, G1): one page whose state follows the product
 * document — the idea screen, the build (story | preview) or the live
 * product — under one step strip that is the only navigation. Older Studios
 * without a product document keep today's view until they are converted
 * (ruling F4, Task 3.7).
 */
import { isChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import {
  dispatchActions,
  useDocumentSafe,
  usePHToast,
  type DocumentDispatch,
} from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
} from "@powerhousedao/shared/document-drive";
import type { PHDocument } from "document-model";
import {
  actions as productActions,
  type StepKind,
  type StudioProductState,
} from "document-models/studio-product";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudioBudget } from "../budget/useStudioBudget.js";
import { ConversationPane } from "../ChatPane.js";
import { StripBudget } from "../budget/BudgetMeter.js";
import { budgetView } from "../budget/budgetStore.js";
import {
  ProductDebugPanel,
  isProductDebugEnabled,
} from "../debug/ProductDebugPanel.js";
import { SignInModal, useFailureHandlers } from "../failures/FailureLine.js";
import { failureFor, withFailure } from "../failures/failureStates.js";
import { useStudioRestarting } from "../failures/useStudioRestarting.js";
import { IdeaScreen } from "../idea/IdeaScreen.js";
import { useStudioSignIn } from "../idea/useStudioSignIn.js";
import { sessionToOpen, startProduct } from "../idea/startProduct.js";
import { LiveSurface } from "../change/LiveSurface.js";
import { startChange } from "../change/startChange.js";
import { PublishPermissionModal } from "../permission/PublishPermissionModal.js";
import { usePublishPermission } from "../permission/usePublishPermission.js";
import { PreviewPane, restartPreview } from "../preview/PreviewPane.js";
import { SettingsDialog } from "../settings/SettingsDialog.js";
import { DataDetail } from "../steps/DataDetail.js";
import { LiveDetail } from "../steps/LiveDetail.js";
import { PlanDetail } from "../steps/PlanDetail.js";
import { planBrief } from "../steps/planBrief.js";
import { TestsDetail } from "../steps/TestsDetail.js";
import { StoryPane } from "../story/StoryPane.js";
import { StepStrip } from "../strip/StepStrip.js";
import { openChange, stripChange, stripModel } from "../strip/stripModel.js";
import { PHASE_AVERAGES } from "../strip/timeLeft.js";
import { useVersionsPanel } from "../versions/VersionsPanel.js";
import { VetraStudio } from "../VetraStudio.js";
import { useStudioState } from "./useStudioState.js";

const STORY_WIDTH_STORAGE_KEY = "vetra-studio:story-width";
/** The live page's failure rows never focus the build's steer box. */
const NO_FOCUS = () => {};
const STORY_WIDTH_DEFAULT = 38;
const STORY_WIDTH_MIN = 24;
const STORY_WIDTH_MAX = 62;

export type StudioShellProps = {
  document: DocumentDriveDocument;
  dispatch: DocumentDispatch<DocumentDriveAction>;
};

export function StudioShell({ document, dispatch }: StudioShellProps) {
  const result = useStudioState(document);
  // While a start runs, the new conversation can be listed before the
  // product: that drive must not be mistaken for an older Studio.
  const [startInFlight, setStartInFlight] = useState(false);
  const [startedSession, setStartedSession] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // "Change who can use it" opens Settings straight on the access switch.
  const [settingsOnAccess, setSettingsOnAccess] = useState(false);
  const [showDebug] = useState(isProductDebugEnabled);
  const driveRef = useRef(document);
  driveRef.current = document;

  const status =
    result.status === "legacy" && startInFlight ? "idea" : result.status;

  useEffect(() => {
    if (result.status === "building" || result.status === "live") {
      setStartInFlight(false);
    }
  }, [result.status]);

  const startFromIdea = useCallback(async (idea: string) => {
    setStartInFlight(true);
    try {
      return sessionToOpen(
        await startProduct({ drive: driveRef.current, idea }),
      );
    } catch (err) {
      setStartInFlight(false);
      throw err;
    }
  }, []);

  const openSettings = useCallback(() => {
    setSettingsOnAccess(false);
    setSettingsOpen(true);
  }, []);
  const openAccessSettings = useCallback(() => {
    setSettingsOnAccess(true);
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsOnAccess(false);
  }, []);

  if (status === "loading") return <ShellLoading />;
  if (status === "legacy") {
    return <VetraStudio document={document} dispatch={dispatch} />;
  }

  const product = result.status === "loading" ? null : result.product;
  const productId = result.status === "loading" ? null : result.productId;
  const documents = result.status === "loading" ? [] : result.documents;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      {status === "idea" ? (
        <IdeaScreen
          onStart={startFromIdea}
          onStarted={setStartedSession}
          onOpenSettings={openSettings}
        />
      ) : (
        <StudioPage
          drive={document}
          documents={documents}
          product={product}
          live={status === "live"}
          fallbackSessionId={startedSession}
          productId={productId}
          onOpenSettings={openSettings}
          onOpenAccess={openAccessSettings}
        />
      )}
      {settingsOpen ? (
        <SettingsDialog
          product={product}
          productId={productId}
          initialSection={settingsOnAccess ? "access" : undefined}
          onClose={closeSettings}
        />
      ) : null}
      {/* D7: the one-time ask right after sign-in, over either screen. */}
      <PublishPermissionModal
        productId={productId}
        studioId={document.header.id}
      />
      {showDebug ? <ProductDebugPanel drive={document} /> : null}
    </div>
  );
}

function ShellLoading() {
  return (
    <div
      aria-busy="true"
      className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground"
    >
      Opening your Studio…
    </div>
  );
}

/** Re-renders every `ms` so relative times ("2 min ago") stay current. */
function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function readStoryWidth(): number {
  try {
    const raw = window.localStorage.getItem(STORY_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed)
      ? clamp(parsed, STORY_WIDTH_MIN, STORY_WIDTH_MAX)
      : STORY_WIDTH_DEFAULT;
  } catch {
    return STORY_WIDTH_DEFAULT;
  }
}

function writeStoryWidth(width: number): void {
  try {
    window.localStorage.setItem(STORY_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Blocked storage: the width lasts for this visit only.
  }
}

/** States 1 and 2: the strip over the build (story | preview) or the live product. */
function StudioPage({
  drive,
  documents,
  product,
  live,
  fallbackSessionId,
  productId,
  onOpenSettings,
  onOpenAccess,
}: {
  drive: DocumentDriveDocument;
  documents: readonly PHDocument[];
  product: StudioProductState | null;
  live: boolean;
  fallbackSessionId: string | undefined;
  productId: string | null;
  onOpenSettings: () => void;
  onOpenAccess: () => void;
}) {
  const now = useNow(30_000);
  const budget = useStudioBudget();
  const usage = budget.snapshot.usage;
  const change = product ? stripChange(product) : null;
  // The time left shown before for this change: it never goes back up.
  const shownTimeLeft = useRef<{ changeId: string; text: string | null }>(null);
  const plainView = stripModel(product, {
    budget: usage
      ? { spentUsd: usage.usageUsd, limitUsd: usage.limitUsd }
      : null,
    averages: PHASE_AVERAGES,
    now,
    prevTimeLeft:
      change && shownTimeLeft.current?.changeId === change.id
        ? shownTimeLeft.current.text
        : null,
  });
  const right = plainView.right;
  const shownBudget = budgetView(budget.snapshot);
  const budgetLevel = shownBudget?.level;
  const studioRestarting = useStudioRestarting();
  const signIn = useStudioSignIn();
  useEffect(() => {
    if (!change || "liveUrl" in right) return;
    shownTimeLeft.current = {
      changeId: change.id,
      text: right.timeLeft ?? null,
    };
  }, [change, right]);
  const [openStep, setOpenStep] = useState<StepKind | null>(null);

  const sessionId = change?.chatSessionId ?? fallbackSessionId;
  const sessionState = useDocumentSafe(sessionId ?? null);
  const sessionDocument =
    sessionState.status === "success" &&
    isChatSessionDocument(sessionState.data)
      ? sessionState.data
      : undefined;
  const chat = sessionDocument?.state.global ?? null;
  const failureBudget = shownBudget
    ? { level: shownBudget.level, request: shownBudget.request }
    : null;
  const permission = usePublishPermission(productId);
  const handlers = useFailureHandlers({
    sessionId: sessionId ?? null,
    productId,
    product,
    requestedBy: signIn.name ?? "you",
    allowPublish: permission.allow,
    focusSteer: NO_FOCUS,
    requestBudget: budget.request,
    restartPreview,
  });
  // Versions (§5.7): every Go back — the panel's and the unhealthy
  // banner's — goes through the same confirmation and checks.
  const versions = useVersionsPanel({
    product,
    productId,
    drive,
    now,
    requestRollback: handlers.requestRollback,
  });
  const liveHandlers = useMemo(
    () => ({ ...handlers, requestRollback: versions.confirmGoBack }),
    [handlers, versions.confirmGoBack],
  );
  // The strip marks the step a failure is on (spec §5.9); state 2's row uses
  // the same failure.
  const failure = failureFor(
    product,
    chat,
    failureBudget,
    {
      studioRestarting,
      publish: permission.state ? { state: permission.state } : null,
    },
    { now, handlers: liveHandlers },
  );
  const view = withFailure(plainView, failure);
  // State 2 (spec §5.6): live, and no change in progress; a change on a live
  // product shows the Live | Preview split (§5.7) on the same surface.
  const liveView = live && product !== null;
  const stateTwo = liveView && openChange(product) === null;
  const previewPane = (
    <PreviewPane
      change={change}
      documents={documents}
      session={sessionDocument}
    />
  );

  // An existing Studio's work before versions is closed: the next request
  // starts a change, which becomes Version 1 (spec §6.6).
  const startNextChange = useCallback(
    (request: string) =>
      productId
        ? startChange({ drive, productId, request, kind: "CHANGE" })
        : Promise.reject(
            new Error("Your product is still loading. Try again in a moment."),
          ),
    [drive, productId],
  );

  const story =
    product && change ? (
      <StoryPane
        product={product}
        change={change}
        chat={chat}
        sessionId={sessionId ?? null}
        productId={productId}
        failureContext={{
          budget: failureBudget,
          requestBudget: budget.request,
          studioRestarting,
          restartPreview,
          publish: permission.state ? { state: permission.state } : null,
          requestedBy: signIn.name ?? "you",
          allowPublish: permission.allow,
        }}
        onStartChange={productId ? startNextChange : undefined}
      />
    ) : sessionId ? (
      /* No readable product yet: the conversation as it is. */
      <ConversationPane
        document={drive}
        sessionId={sessionId}
        driveLoaded={true}
      />
    ) : (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Getting ready…
      </div>
    );

  const toast = usePHToast();
  const rename = useCallback(
    (name: string) => {
      if (!productId) return;
      const failed = () =>
        toast?.("Couldn't rename it. Try again.", { type: "error" });
      // The name only: the web address (slug) is separate and never changes here.
      dispatchActions(
        productActions.renameProduct({ name }),
        productId,
        failed,
      ).catch(failed);
    },
    [productId, toast],
  );

  const toggleStep = useCallback((kind: StepKind) => {
    setOpenStep((current) => (current === kind ? null : kind));
  }, []);

  // A change on a live product keeps its split: no step detail over it.
  const following =
    openStep === null || (!stateTwo && (liveView || openStep === "EDITORS"));
  const detail = following ? null : (
    <StepDetail
      kind={openStep}
      drive={drive}
      documents={documents}
      product={product}
      now={now}
      preview={previewPane}
    />
  );

  return (
    <>
      <StepStrip
        view={view}
        selected={openStep}
        onOpenStep={toggleStep}
        onOpenSettings={onOpenSettings}
        onRename={productId ? rename : undefined}
        versions={
          product?.liveVersion != null
            ? { live: product.liveVersion, onOpen: versions.openPanel }
            : undefined
        }
        budget={
          "budget" in right && (right.budget || budgetLevel === "exhausted") ? (
            <StripBudget
              text={right.budget}
              view={budgetView(budget.snapshot)}
              onRequest={budget.request}
            />
          ) : undefined
        }
      />
      {liveView ? (
        detail ? (
          <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            {detail}
          </main>
        ) : (
          <main className="flex min-h-0 flex-1 flex-col">
            <LiveSurface
              product={product}
              productId={productId}
              drive={drive}
              documents={documents}
              failure={failure}
              now={now}
              story={change ? story : null}
              preview={previewPane}
              requestedBy={signIn.name ?? "you"}
              onOpenAccess={onOpenAccess}
            />
          </main>
        )
      ) : (
        <BuildSplit
          story={story}
          main={
            detail ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 justify-end border-b border-border bg-card px-4 py-1.5">
                  <button
                    type="button"
                    onClick={() => setOpenStep(null)}
                    className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                  >
                    Following you · Back to the build
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
                  {detail}
                </div>
              </div>
            ) : (
              previewPane
            )
          }
        />
      )}
      {signIn.status === "signed-out" ? (
        /* The session ended: sign in again over the page, which stays. */
        <SignInModal onSignIn={signIn.signIn} />
      ) : null}
      {versions.element}
    </>
  );
}

function StepDetail({
  kind,
  drive,
  documents,
  product,
  now,
  preview,
}: {
  kind: StepKind;
  drive: DocumentDriveDocument;
  documents: readonly PHDocument[];
  product: StudioProductState | null;
  now: Date;
  preview: React.ReactNode;
}) {
  switch (kind) {
    case "PLAN":
      return (
        <PlanDetail
          idea={product?.idea ?? null}
          brief={planBrief(drive.state.global.nodes, documents)}
        />
      );
    case "DATA":
      return <DataDetail documents={documents} />;
    case "EDITORS":
      return <div className="flex h-[70vh] flex-col">{preview}</div>;
    case "TESTS":
      return <TestsDetail change={product ? stripChange(product) : null} />;
    case "LIVE":
      return <LiveDetail product={product} now={now} />;
  }
}

/** Story on the left (resizable, ~38 %), the preview or a step on the right. */
function BuildSplit({
  story,
  main,
}: {
  story: React.ReactNode;
  main: React.ReactNode;
}) {
  const [width, setWidth] = useState(readStoryWidth);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Removes a drag's window listeners (on mouse up or unmount). */
  const endDrag = useRef<(() => void) | null>(null);

  useEffect(() => () => endDrag.current?.(), []);

  function onMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    endDrag.current?.();
    setDragging(true);
    let latest: number | null = null;
    function onMove(e: MouseEvent) {
      if (!rect) return;
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      latest = clamp(percent, STORY_WIDTH_MIN, STORY_WIDTH_MAX);
      setWidth(latest);
    }
    function detach() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      endDrag.current = null;
    }
    function onUp() {
      detach();
      setDragging(false);
      // Stored once per drag, when it ends.
      if (latest !== null) writeStoryWidth(latest);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    endDrag.current = detach;
  }

  function resetWidth() {
    setWidth(STORY_WIDTH_DEFAULT);
    writeStoryWidth(STORY_WIDTH_DEFAULT);
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
      <aside
        aria-label="Story"
        className="flex shrink-0 flex-col bg-card"
        style={{ width: `${width}%` }}
      >
        {story}
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize"
        onMouseDown={onMouseDown}
        onDoubleClick={resetWidth}
        className="w-1.5 shrink-0 cursor-col-resize border-x border-border bg-card hover:bg-accent"
      />
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {main}
      </main>
      {dragging ? (
        /* Keeps the preview iframe from swallowing the drag. */
        <div aria-hidden className="fixed inset-0 z-50 cursor-col-resize" />
      ) : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
