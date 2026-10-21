/**
 * State 0, the blank idea screen (spec §5.3): one large input, three example
 * chips, and Build it. Top right: what there is to spend and the account
 * menu — no strip, no session list, no tabs.
 *
 * Signed out, Build it keeps the idea in this browser (pendingIdea) and opens
 * sign-in; when the visitor is back signed in — in place or after the
 * redirect — the kept idea is sent once, and stays kept until the start
 * succeeds. The start itself (product, first
 * conversation, first message, the story's first line) is `onStart`, which
 * the shell wires to `startProduct`.
 *
 * With files attached, the button reads them first (idea → understanding →
 * understood): a waiting state with the files, then "What I understood",
 * where the customer corrects the picture and builds it (`onBuildDraft`).
 * Back keeps the corrected draft; asking again with the same files and text
 * shows it again without a new read.
 */
import { usePHToast } from "@powerhousedao/reactor-browser";
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UnderstoodDraft } from "../../../shared/understood-draft.js";
import { useStudioBudget } from "../budget/useStudioBudget.js";
import { translate, type Language } from "../i18n/language.js";
import type { MessageKey } from "../i18n/messages.en.js";
import { useT } from "../i18n/useT.js";
import { AccountMenu } from "../shell/AccountMenu.js";
import {
  requestUnderstanding,
  WorkshopClientError,
  type MaterialCard,
} from "../hooks/workshop-client.js";
import {
  UnderstoodView,
  type UnderstoodNote,
} from "../understood/UnderstoodView.js";
import VetraMitosis from "../VetraMitosis.js";
import { MATERIAL_ICON, MaterialDrop } from "./MaterialDrop.js";
import {
  clearPendingIdea,
  peekPendingIdea,
  savePendingIdea,
} from "./pendingIdea.js";
import { useStudioSignIn } from "./useStudioSignIn.js";

/** How long Build it waits for an unsettled sign-in state. */
export const SIGN_IN_CHECK_TIMEOUT_MS = 15_000;
/** After this long reading, the waiting state says big diagrams take longer. */
export const SLOW_READING_MS = 20_000;

const IDEA_EXAMPLE_KEYS = [
  "idea.example.breakfast",
  "idea.example.maintenance",
  "idea.example.invoices",
] as const satisfies readonly MessageKey[];

/** `$10 to spend`: what is left of the Studio's limit; "" when unknown. */
export function spendText(
  usage: { usageUsd: number; limitUsd: number | null } | null | undefined,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string = (
    key,
    vars,
  ) => translate("en", key, vars),
): string {
  if (!usage || usage.limitUsd === null) return "";
  const left = Math.max(0, usage.limitUsd - usage.usageUsd);
  const amount = Number.isInteger(left) ? `$${left}` : `$${left.toFixed(2)}`;
  return t("idea.spend", { amount });
}

export type IdeaScreenProps = {
  /** Starts the product from the idea; resolves the conversation to open. */
  onStart: (idea: string) => Promise<string | undefined>;
  onStarted: (sessionId: string) => void;
  onOpenSettings: () => void;
  /** Builds from the corrected picture; resolves the conversation to open.
   *  Without it, Build this starts from the idea text (`onStart`). */
  onBuildDraft?: (input: {
    idea: string;
    draft: UnderstoodDraft;
    language: Language;
  }) => Promise<string | undefined>;
};

type Phase = "idea" | "understanding" | "understood";

/** What a read was asked with: the same again shows the kept draft. */
function askKey(cards: readonly MaterialCard[], text: string): string {
  return JSON.stringify([cards.map((c) => c.id), text]);
}

export function IdeaScreen({
  onStart,
  onStarted,
  onOpenSettings,
  onBuildDraft,
}: IdeaScreenProps) {
  const { t, language } = useT();
  const auth = useStudioSignIn();
  const budget = useStudioBudget();
  const toast = usePHToast();
  const [idea, setIdea] = useState("");
  const [cards, setCards] = useState<MaterialCard[]>([]);
  const [starting, setStarting] = useState(false);
  /** Build it was pressed while the sign-in state was still unknown. */
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);
  /** The kept idea is sent at most once per page. */
  const sentRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idea");
  const [slow, setSlow] = useState(false);
  /** The draft (kept on Back), what it was asked with, and its notes. */
  const [kept, setKept] = useState<{
    key: string;
    draft: UnderstoodDraft;
    notes: UnderstoodNote[];
    round: number;
  } | null>(null);
  /** Notes from files that could not be read at all (shown under the box). */
  const [failedNotes, setFailedNotes] = useState<UnderstoodNote[]>([]);
  const readRef = useRef<AbortController | null>(null);

  useEffect(() => () => readRef.current?.abort(), []);

  useEffect(() => {
    if (phase !== "understanding") return;
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_READING_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Back from sign-in (or a reload): show the kept idea in the box.
  useEffect(() => {
    const kept = peekPendingIdea();
    if (kept) setIdea((current) => current || kept);
  }, []);

  // Latest start/signIn for the effects below (both are new each render).
  const startRef = useRef(start);
  const signInRef = useRef(auth.signIn);
  useEffect(() => {
    startRef.current = start;
    signInRef.current = auth.signIn;
  });

  // Signed in with a kept idea: send it, once. It stays kept until the
  // start succeeds (the product exists), so a failed start loses nothing.
  useEffect(() => {
    if (auth.status === "signed-in") {
      setAwaitingSignIn(false);
      if (sentRef.current) return;
      const kept = peekPendingIdea();
      if (!kept) return;
      sentRef.current = true;
      setIdea(kept);
      void startRef.current(kept);
    } else if (auth.status === "signed-out" && awaitingSignIn) {
      setAwaitingSignIn(false);
      signInRef.current();
    }
  }, [auth.status, awaitingSignIn, startRef, signInRef]);

  // Sign-in state that never settles: give the button back after a while.
  useEffect(() => {
    if (!awaitingSignIn) return;
    const timer = setTimeout(
      () => setAwaitingSignIn(false),
      SIGN_IN_CHECK_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [awaitingSignIn]);

  async function start(text: string) {
    setStarting(true);
    try {
      const sessionId = await onStart(text);
      clearPendingIdea();
      if (sessionId) onStarted(sessionId);
    } catch (err) {
      console.error("Failed to start the product", err);
      setStarting(false);
      // A retry resumes where the start stopped (startProduct is resumable).
      toast?.(
        <span className="flex items-center gap-2">
          <span>{t("idea.startFailed")}</span>
          <button
            type="button"
            onClick={() => void start(text)}
            className="rounded px-1.5 py-0.5 font-medium underline"
          >
            {t("idea.tryAgain")}
          </button>
        </span>,
        { type: "error" },
      );
    }
  }

  async function understand(text: string) {
    const key = askKey(cards, text);
    setFailedNotes([]);
    if (kept?.key === key) {
      setPhase("understood");
      return;
    }
    readRef.current?.abort();
    const controller = new AbortController();
    readRef.current = controller;
    setPhase("understanding");
    try {
      const result = await requestUnderstanding(
        { materialIds: cards.map((c) => c.id), text, language },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setKept((prev) => ({
        key,
        draft: result.draft,
        notes: result.notes,
        round: (prev?.round ?? 0) + 1,
      }));
      setPhase("understood");
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase("idea");
      const code = err instanceof WorkshopClientError ? err.code : "network";
      if (code === "unreadable") {
        const notes =
          err instanceof WorkshopClientError ? (err.notes ?? []) : [];
        setFailedNotes(
          notes.length > 0
            ? notes
            : [{ materialId: null, text: t("understood.failed") }],
        );
      } else {
        toast?.(
          t(code === "budget" ? "understood.budget" : "understood.failed"),
          { type: "error" },
        );
      }
    }
  }

  async function buildDraft(draft: UnderstoodDraft) {
    const text = idea.trim();
    setStarting(true);
    try {
      // Until the draft is handed to the build itself, the idea text
      // (or the picture's summary) starts it.
      const sessionId = onBuildDraft
        ? await onBuildDraft({ idea: text, draft, language })
        : await onStart(text || draft.summary);
      clearPendingIdea();
      if (sessionId) onStarted(sessionId);
    } catch (err) {
      console.error("Failed to start the product", err);
      setStarting(false);
      toast?.(t("idea.startFailed"), { type: "error" });
    }
  }

  function submit() {
    const text = idea.trim();
    const withFiles = cards.length > 0;
    if ((!text && !withFiles) || starting || awaitingSignIn) return;
    if (withFiles && auth.status === "signed-in") {
      void understand(text);
      return;
    }
    if (!text) return;
    if (auth.status === "signed-in") {
      sentRef.current = true;
      void start(text);
      return;
    }
    savePendingIdea(text);
    if (auth.status === "signed-out") auth.signIn();
    else setAwaitingSignIn(true);
  }

  function fill(example: string) {
    setIdea(example);
    inputRef.current?.focus();
  }

  const busy = starting || awaitingSignIn;
  const spend = spendText(budget.snapshot.usage, t);

  const top = (
    <div className="flex shrink-0 items-center justify-end gap-3 px-4 py-2">
      {spend ? (
        <span className="text-xs font-medium text-muted-foreground">
          {spend}
        </span>
      ) : null}
      <AccountMenu
        name={auth.name}
        hasUser={auth.hasUser}
        onSignIn={auth.signIn}
        onSignOut={auth.signOut}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );

  return (
    <>
      {top}
      {phase === "understanding" ? (
        <div
          role="status"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-16 text-center"
        >
          <VetraMitosis size={48} active />
          <ul className="flex flex-wrap justify-center gap-2">
            {cards.map((card) => {
              const Icon = MATERIAL_ICON[card.kind];
              return (
                <li
                  key={card.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground"
                >
                  <Icon className="size-3.5" aria-hidden />
                  <span className="max-w-48 truncate">{card.name}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-base font-medium text-foreground">
            {t("understood.reading")}
          </p>
          {slow ? (
            <p className="text-sm text-muted-foreground">
              {t("understood.slow")}
            </p>
          ) : null}
        </div>
      ) : null}
      {phase === "understood" && kept ? (
        <UnderstoodView
          key={kept.round}
          draft={kept.draft}
          notes={kept.notes}
          busy={starting}
          onChange={(draft) =>
            setKept((prev) => (prev ? { ...prev, draft } : prev))
          }
          onBuild={(draft) => void buildDraft(draft)}
          onBack={() => setPhase("idea")}
        />
      ) : null}
      {/* The idea box stays mounted (hidden) so its files survive a read. */}
      <div
        hidden={phase !== "idea"}
        className="flex min-h-0 flex-1 items-center justify-center px-6 pb-16"
      >
        <form
          className="flex w-full max-w-2xl flex-col items-center gap-5 text-center"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <VetraMitosis size={48} active={busy} />
          <h1 className="text-2xl font-semibold text-foreground">
            {t("idea.heading")}
          </h1>
          <MaterialDrop
            disabled={busy}
            signedIn={auth.status === "signed-in"}
            onSignInNeeded={() => {
              const text = idea.trim();
              if (text) savePendingIdea(text);
              if (auth.status === "signed-out") auth.signIn();
            }}
            onCards={setCards}
          >
            <textarea
              ref={inputRef}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={4}
              disabled={busy}
              placeholder={t("idea.placeholder")}
              aria-label={t("idea.inputLabel")}
              className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-vetra-primary"
            />
          </MaterialDrop>
          {failedNotes.length > 0 ? (
            <ul className="flex w-full flex-col gap-1">
              {failedNotes.map((n, i) => (
                <li
                  key={`${n.materialId ?? ""}-${i}`}
                  role="alert"
                  className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-1.5 text-left text-xs text-warning"
                >
                  <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                  {n.text}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="submit"
            disabled={busy || (!idea.trim() && cards.length === 0)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-vetra-primary px-5 py-2 text-sm font-medium text-vetra-primary-fg shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-vetra-primary focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? t("idea.starting")
              : cards.length > 0
                ? t("idea.understand")
                : t("idea.build")}
          </button>
          <div className="flex flex-wrap justify-center gap-2">
            {IDEA_EXAMPLE_KEYS.map((key) => {
              const example = t(key);
              return (
                <button
                  key={example}
                  type="button"
                  disabled={busy}
                  onClick={() => fill(example)}
                  className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {example}
                </button>
              );
            })}
          </div>
        </form>
      </div>
    </>
  );
}
