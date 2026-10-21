/**
 * The Studio page (spec §5.1, G1): one page whose state follows the product
 * document — the idea screen, the build (story | preview) or the live
 * product — under one step strip that is the only navigation. Older Studios
 * without a product document keep today's view until they are converted
 * (ruling F4, Task 3.7).
 */
import { isChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import {
  useDocumentSafe,
  type DocumentDispatch,
} from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveAction,
  DocumentDriveDocument,
} from "@powerhousedao/shared/document-drive";
import type { PHDocument } from "document-model";
import type {
  StepKind,
  StudioProductState,
} from "document-models/studio-product";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StudioBudgetMeter } from "../budget/BudgetMeter.js";
import { useStudioBudget } from "../budget/useStudioBudget.js";
import { PreviewBody } from "../BuildSection.js";
import { ConversationPane, IdeaStart } from "../ChatPane.js";
import {
  ProductDebugPanel,
  isProductDebugEnabled,
} from "../debug/ProductDebugPanel.js";
import { useResolvedPreview } from "../hooks/useResolvedPreview.js";
import { useSessionPreviewTarget } from "../hooks/useSessionPreviewTarget.js";
import { sessionToOpen, startProduct } from "../idea/startProduct.js";
import { SettingsDialog } from "../settings/SettingsDialog.js";
import { DataDetail } from "../steps/DataDetail.js";
import { LiveDetail } from "../steps/LiveDetail.js";
import { PlanDetail } from "../steps/PlanDetail.js";
import { planBrief } from "../steps/planBrief.js";
import { plainModel, type ModelSpec } from "../steps/plainModel.js";
import { TestsDetail } from "../steps/TestsDetail.js";
import { StepStrip, SettingsButton } from "../strip/StepStrip.js";
import { stripChange, stripModel } from "../strip/stripModel.js";
import { VetraStudio } from "../VetraStudio.js";
import { useStudioState } from "./useStudioState.js";

const DOCUMENT_MODEL_TYPE = "powerhouse/document-model";
const STORY_WIDTH_STORAGE_KEY = "vetra-studio:story-width";
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
        <IdeaView
          onStart={startFromIdea}
          onStarted={setStartedSession}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <ProductView
          drive={document}
          documents={documents}
          product={product}
          live={status === "live"}
          fallbackSessionId={startedSession}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {settingsOpen ? (
        <SettingsDialog
          product={product}
          productId={productId}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
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

/** State 0 until the idea screen (Task 1.5) replaces the box. */
function IdeaView({
  onStart,
  onStarted,
  onOpenSettings,
}: {
  onStart: (idea: string) => Promise<string | undefined>;
  onStarted: (sessionId: string) => void;
  onOpenSettings: () => void;
}) {
  return (
    <>
      <div className="flex shrink-0 items-center justify-end gap-3 px-4 py-2">
        <StudioBudgetMeter />
        <SettingsButton onOpen={onOpenSettings} />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="flex w-full max-w-xl flex-col">
          <IdeaStart onStart={onStart} onStarted={onStarted} />
        </div>
      </div>
    </>
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

function modelSpecOf(doc: PHDocument): ModelSpec {
  const global = (doc.state as { global?: unknown }).global;
  return global && typeof global === "object" ? global : {};
}

/** States 1 and 2: the strip over the build (story | preview) or the live product. */
function ProductView({
  drive,
  documents,
  product,
  live,
  fallbackSessionId,
  onOpenSettings,
}: {
  drive: DocumentDriveDocument;
  documents: readonly PHDocument[];
  product: StudioProductState | null;
  live: boolean;
  fallbackSessionId: string | undefined;
  onOpenSettings: () => void;
}) {
  const now = useNow(30_000);
  const budget = useStudioBudget();
  const usage = budget.snapshot.usage;
  const change = product ? stripChange(product) : null;
  const view = stripModel(product, {
    budget: usage
      ? { spentUsd: usage.usageUsd, limitUsd: usage.limitUsd }
      : null,
    averages: {},
    now,
  });
  const [openStep, setOpenStep] = useState<StepKind | null>(null);

  const sessionId = change?.chatSessionId ?? fallbackSessionId;
  const sessionState = useDocumentSafe(sessionId ?? null);
  const sessionDocument =
    sessionState.status === "success" &&
    isChatSessionDocument(sessionState.data)
      ? sessionState.data
      : undefined;
  const preview = useResolvedPreview(useSessionPreviewTarget(sessionDocument));

  const models = useMemo(
    () =>
      documents
        .filter((d) => d.header.documentType === DOCUMENT_MODEL_TYPE)
        .map((d) => ({ id: d.header.id, model: plainModel(modelSpecOf(d)) })),
    [documents],
  );

  const toggleStep = useCallback((kind: StepKind) => {
    setOpenStep((current) => (current === kind ? null : kind));
  }, []);

  const following = openStep === null || (!live && openStep === "EDITORS");
  const detail = following ? null : (
    <StepDetail
      kind={openStep}
      drive={drive}
      documents={documents}
      product={product}
      models={models}
      now={now}
      preview={<PreviewBody preview={preview} />}
    />
  );

  return (
    <>
      <StepStrip
        view={view}
        selected={openStep}
        onOpenStep={toggleStep}
        onOpenSettings={onOpenSettings}
      />
      {live ? (
        <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {detail ?? <LiveDetail product={product} now={now} />}
        </main>
      ) : (
        <BuildSplit
          story={
            sessionId ? (
              <ConversationPane
                document={drive}
                sessionId={sessionId}
                driveLoaded={true}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Getting ready…
              </div>
            )
          }
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
              <PreviewBody preview={preview} />
            )
          }
        />
      )}
    </>
  );
}

function StepDetail({
  kind,
  drive,
  documents,
  product,
  models,
  now,
  preview,
}: {
  kind: StepKind;
  drive: DocumentDriveDocument;
  documents: readonly PHDocument[];
  product: StudioProductState | null;
  models: readonly { id: string; model: ReturnType<typeof plainModel> }[];
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
      return <DataDetail models={models} />;
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

  useEffect(() => writeStoryWidth(width), [width]);

  function onMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setDragging(true);
    function onMove(e: MouseEvent) {
      if (!rect) return;
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      setWidth(clamp(percent, STORY_WIDTH_MIN, STORY_WIDTH_MAX));
    }
    function onUp() {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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
        onDoubleClick={() => setWidth(STORY_WIDTH_DEFAULT)}
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
