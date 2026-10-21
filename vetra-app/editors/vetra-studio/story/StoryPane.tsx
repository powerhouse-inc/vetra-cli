/**
 * The story pane (spec §5.4): the build told as a story on the left while
 * the agent works — the idea, a line per milestone with a live "doing now"
 * sub-line, the agent's replies, steer messages with their delivery state,
 * stuck / needs-you / paused lines — with the steer box at the bottom. Each
 * line expands to its raw detail (today's transcript, folded).
 */
import type { ContentPart } from "@powerhousedao/clint-common/document-models/chat-session";
import { usePHToast } from "@powerhousedao/reactor-browser";
import type {
  Change,
  PermissionState,
  StudioProductState,
} from "document-models/studio-product";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RawDetail } from "../ChatPane.js";
import { ChangeRequest } from "../change/ChangeDrawer.js";
import {
  FailureActions,
  FailureLine,
  useFailureHandlers,
} from "../failures/FailureLine.js";
import {
  failureFor,
  notDeliveredFailure,
  shownInline,
  SIMPLER_MESSAGE,
  SKIP_MESSAGE,
  stuckText,
  type Failure,
  type FailureBudget,
  type FailureHandlers,
} from "../failures/failureStates.js";
import {
  DELIVERY_TEXT,
  SteerBox,
  continueChange,
  continueFailureText,
  sendSteer,
} from "./SteerBox.js";
import { AwayCard } from "./AwayCard.js";
import { LayerSwitch } from "./LayerSwitch.js";
import { copyAllText } from "./copyAll.js";
import { DEFAULT_LAYER, layerLines, type StoryLayer } from "./storyLayers.js";
import {
  agentWorking,
  nextStoryChange,
  staleness,
  storyLines,
  toolResultsOf,
  type StoryChange,
  type StoryChat,
  type StoryLine,
} from "./storyModel.js";

export const PAUSED_TEXT =
  "Paused — nothing is lost. Continue when you're ready.";

/** Re-renders every `ms` so the waiting line and delivery states move on. */
function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** What the failure lines need beyond the documents (spec §5.9). */
export type StoryFailureContext = {
  budget: FailureBudget;
  requestBudget: () => void;
  studioRestarting: boolean;
  /** The preview pane's `restartPreview()`. */
  restartPreview: () => Promise<void>;
  /** The owner's publishing permission (`usePublishPermission`, Task 2.8). */
  publish?: { state: PermissionState } | null;
  /** Who asks the agent, recorded on a launch request. */
  requestedBy?: string;
  /** The OK to publish, for the permission row's Allow (Task 2.8). */
  allowPublish?: () => void | Promise<boolean>;
};

const NO_FAILURE_CONTEXT: StoryFailureContext = {
  budget: null,
  requestBudget: () => {},
  studioRestarting: false,
  restartPreview: () => Promise.resolve(),
};

export type StoryPaneProps = {
  /** Normalised product state (`readProduct`). */
  product: StudioProductState;
  change: Change;
  /** The build's conversation; null while it loads. */
  chat: StoryChat | null;
  sessionId: string | null;
  productId: string | null;
  /** The Studio's id: keys the "while you were away" visit time. */
  studioId?: string;
  /** Fixed time (tests); the pane ticks on its own otherwise. */
  now?: Date;
  failureContext?: StoryFailureContext;
  /** Starts a new change; asked for under a closed change (an existing
   *  Studio's work before versions, spec §6.6) instead of steering it. */
  onStartChange?: (request: string) => Promise<unknown>;
  /** The shown layer (controlled); the pane keeps its own when omitted. */
  layer?: StoryLayer;
  onLayerChange?: (layer: StoryLayer) => void;
};

export function StoryPane({
  product,
  change,
  chat,
  sessionId,
  productId,
  studioId,
  now: fixedNow,
  failureContext = NO_FAILURE_CONTEXT,
  onStartChange,
  layer: controlledLayer,
  onLayerChange,
}: StoryPaneProps) {
  const [ownLayer, setOwnLayer] = useState<StoryLayer>(DEFAULT_LAYER);
  const layer = controlledLayer ?? ownLayer;
  function changeLayer(next: StoryLayer) {
    setOwnLayer(next);
    onLayerChange?.(next);
  }
  const ticking = useNow(5_000);
  const now = fixedNow ?? ticking;
  const lines = storyLines(product, change, chat, now);
  const openQuestion = lines
    .filter(
      (l): l is Extract<StoryLine, { kind: "reply" }> =>
        l.kind === "reply" && l.question,
    )
    .at(-1)?.text;
  const working = agentWorking(chat) && change.status === "BUILDING";
  // When the shown story last changed (G3 counts quiet time from that).
  const changeRef = useRef<StoryChange | null>(null);
  changeRef.current = nextStoryChange(
    changeRef.current,
    lines,
    fixedNow ? fixedNow.getTime() : Date.now(),
  );
  const waiting = staleness(lines, { working }, now, changeRef.current.at);
  const layered = layerLines(lines, change, layer);
  // The waiting line is a transient status below the story, not a story line.
  const shown = layered;
  const messages = chat?.messages;
  const results = useMemo(() => toolResultsOf(messages ?? []), [messages]);
  const steerRef = useRef<HTMLInputElement | null>(null);
  const toast = usePHToast();
  const focusSteer = useCallback(() => steerRef.current?.focus(), []);
  const handlers = useFailureHandlers({
    sessionId,
    productId,
    product,
    requestedBy: failureContext.requestedBy,
    allowPublish: failureContext.allowPublish,
    focusSteer,
    requestBudget: failureContext.requestBudget,
    restartPreview: failureContext.restartPreview,
  });
  const failure = failureFor(
    product,
    chat,
    failureContext.budget,
    {
      studioRestarting: failureContext.studioRestarting,
      publish: failureContext.publish ?? null,
    },
    { now, handlers },
  );

  // Newest at the bottom; follow it unless the customer scrolled up.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const newestKey = `${shown.length}:${shown.at(-1)?.id}:${shown.at(-1)?.at}:${waiting?.id}`;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [newestKey]);

  function send(text: string) {
    if (!sessionId) return;
    sendSteer(sessionId, text).catch(() =>
      toast?.("Couldn't send it. Try again.", { type: "error" }),
    );
  }

  function copyAll() {
    const clipboard = (
      navigator as { clipboard?: Navigator["clipboard"] | undefined }
    ).clipboard;
    (clipboard
      ? clipboard.writeText(copyAllText(lines, results))
      : Promise.reject(new Error("no clipboard"))
    )
      .then(() => toast?.("Copied", { type: "success" }))
      .catch(() => toast?.("Couldn't copy", { type: "error" }));
  }

  function resume() {
    if (!productId) return;
    continueChange(productId, change.id, sessionId).catch((err) =>
      toast?.(continueFailureText(err), { type: "error" }),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <LayerSwitch value={layer} onChange={changeLayer} />
        {layer === "raw" ? (
          <ActionButton onClick={copyAll}>Copy all</ActionButton>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {studioId ? (
          <AwayCard
            studioId={studioId}
            product={product}
            question={openQuestion}
          />
        ) : null}
        <ol data-story-layer={layer} className="flex flex-col gap-2">
          {shown.map((line) => (
            <li key={line.id} data-line={line.kind} data-story-line>
              <Line
                layer={layer}
                line={line}
                results={results}
                onSend={send}
                onTellMeHow={focusSteer}
                onContinue={resume}
                failure={failure}
                handlers={handlers}
              />
            </li>
          ))}
          {failure && !shownInline(failure) ? (
            <li key="failure" data-line="failure">
              <FailureLine failure={failure} />
            </li>
          ) : null}
        </ol>
        {waiting ? (
          <p
            data-line="waiting"
            className="mt-2 text-xs italic text-muted-foreground"
          >
            {waiting.text}
          </p>
        ) : null}
      </div>
      {change.status === "CLOSED" && onStartChange ? (
        <div className="shrink-0 border-t border-border bg-card px-3 py-2">
          <ChangeRequest
            product={product}
            onStart={onStartChange}
            prefill={null}
          />
        </div>
      ) : (
        <SteerBox
          sessionId={sessionId}
          productId={productId}
          changeId={change.id}
          paused={change.status === "PAUSED"}
          messages={messages ?? []}
          now={now}
          inputRef={steerRef}
        />
      )}
    </div>
  );
}

function Line({
  line,
  layer,
  results,
  onSend,
  onTellMeHow,
  onContinue,
  failure,
  handlers,
}: {
  line: StoryLine;
  layer: StoryLayer;
  results: ReadonlyMap<string, ContentPart>;
  onSend: (text: string) => void;
  onTellMeHow: () => void;
  onContinue: () => void;
  failure: Failure | null;
  handlers: FailureHandlers;
}) {
  switch (line.kind) {
    case "idea":
      return (
        <Expandable
          detail={line.detail}
          results={results}
          open={layer === "raw"}
        >
          <span className="text-sm italic text-foreground">“{line.text}”</span>
        </Expandable>
      );
    case "milestone":
      return (
        <div>
          <Expandable
            detail={line.detail}
            results={results}
            open={layer === "raw"}
          >
            <span className="flex items-baseline gap-2 text-sm text-foreground">
              <span
                aria-hidden
                className={
                  line.mark === "◐"
                    ? "animate-pulse text-vetra-primary"
                    : line.mark === "⟲"
                      ? "text-muted-foreground"
                      : "text-emerald-600"
                }
              >
                {line.mark}
              </span>
              <span
                className={
                  line.mark === "⟲" ? "text-xs text-muted-foreground" : ""
                }
              >
                {line.text}
              </span>
            </span>
          </Expandable>
          {layer === "activity" && line.summary ? (
            <p className="ml-5 truncate text-xs text-muted-foreground">
              {line.summary}
            </p>
          ) : null}
          {line.doingNow ? (
            <p className="ml-5 text-xs text-muted-foreground">
              {line.doingNow}
            </p>
          ) : null}
        </div>
      );
    case "reply":
      return line.question ? (
        <Question text={line.text} onAnswer={onSend} />
      ) : (
        <p className="whitespace-pre-wrap rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
          {line.text}
        </p>
      );
    case "steer":
      return (
        <div className="flex flex-col items-end">
          <p className="whitespace-pre-wrap rounded-xl bg-vetra-primary/10 px-3 py-2 text-sm text-foreground">
            {line.text}
          </p>
          <span
            data-delivery={line.delivery}
            className={
              "mt-0.5 text-xs " +
              (line.delivery === "not-delivered"
                ? "text-amber-600"
                : "text-muted-foreground")
            }
          >
            {DELIVERY_TEXT[line.delivery]}
          </span>
          {line.delivery === "not-delivered" ? (
            <span className="mt-1">
              <FailureActions
                actions={notDeliveredFailure(line.id, handlers).actions}
              />
            </span>
          ) : null}
        </div>
      );
    case "stuck":
      return (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm">
          <p className="text-foreground">
            {stuckText(line.reason, line.tried)}
          </p>
          {line.tried.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {line.tried.map((tried, i) => (
                <li key={i}>{tried}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton onClick={() => onSend(SIMPLER_MESSAGE)}>
              Try a simpler version
            </ActionButton>
            <ActionButton onClick={() => onSend(SKIP_MESSAGE)}>
              Skip this part
            </ActionButton>
            <ActionButton onClick={onTellMeHow}>Tell me how</ActionButton>
          </div>
        </div>
      );
    case "attention":
      if (
        failure &&
        (failure.situation === "breather" ||
          failure.situation === "preview-slow") &&
        failure.stripStep === line.step
      ) {
        return <FailureLine failure={failure} />;
      }
      return (
        <p className="flex items-baseline gap-2 text-sm text-amber-700 dark:text-amber-400">
          <span aria-hidden>!</span>
          <span>{line.text}</span>
        </p>
      );
    case "paused":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
          <span>{PAUSED_TEXT}</span>
          <ActionButton onClick={onContinue}>Continue</ActionButton>
        </div>
      );
    case "checks":
      return (
        <div className="text-sm">
          <p className="text-foreground">{line.text}</p>
          {line.failed ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {line.failed}
            </p>
          ) : null}
          {line.reasons.length > 0 ? (
            <ul className="mt-0.5 list-disc pl-5 text-xs text-muted-foreground">
              {line.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    case "waiting":
      return (
        <p className="text-xs italic text-muted-foreground">{line.text}</p>
      );
  }
}

function ActionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
    >
      {children}
    </button>
  );
}

/** A question from the agent, highlighted, with a box to answer it. */
function Question({
  text,
  onAnswer,
}: {
  text: string;
  onAnswer: (text: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  return (
    <div className="rounded-xl border border-vetra-primary/60 bg-vetra-primary/5 px-3 py-2">
      <p className="whitespace-pre-wrap text-sm text-foreground">{text}</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = answer.trim();
          if (!value) return;
          onAnswer(value);
          setAnswer("");
        }}
      >
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer"
          aria-label="Your answer"
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-vetra-primary"
        />
        <button
          type="submit"
          disabled={!answer.trim()}
          className="rounded-lg bg-vetra-primary px-2.5 py-1 text-xs font-medium text-vetra-primary-fg disabled:opacity-50"
        >
          Answer
        </button>
      </form>
    </div>
  );
}

/** A line that expands to its raw detail when it has any. */
function Expandable({
  detail,
  results,
  open: forcedOpen = false,
  children,
}: {
  detail: Parameters<typeof RawDetail>[0]["messages"];
  results: ReadonlyMap<string, ContentPart>;
  /** The Raw layer shows every detail unfolded. */
  open?: boolean;
  children: ReactNode;
}) {
  const [toggled, setOpen] = useState(false);
  const open = forcedOpen || toggled;
  if (detail.length === 0) return <>{children}</>;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={open ? "Hide the details" : "Show the details"}
        className="w-full text-left hover:opacity-80"
      >
        {children}
      </button>
      {open ? (
        <div className="ml-5 mt-1 border-l border-border pl-3">
          <RawDetail messages={detail} results={results} />
        </div>
      ) : null}
    </div>
  );
}
