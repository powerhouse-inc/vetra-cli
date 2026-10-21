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
 */
import { usePHToast } from "@powerhousedao/reactor-browser";
import { useEffect, useRef, useState } from "react";
import { useStudioBudget } from "../budget/useStudioBudget.js";
import { AccountMenu } from "../shell/AccountMenu.js";
import VetraMitosis from "../VetraMitosis.js";
import {
  clearPendingIdea,
  peekPendingIdea,
  savePendingIdea,
} from "./pendingIdea.js";
import { useStudioSignIn } from "./useStudioSignIn.js";

export const IDEA_HEADING = "What do you want to build?";
export const IDEA_PLACEHOLDER =
  "Describe your product in a sentence or two — who it's for and what they do with it.";
/** How long Build it waits for an unsettled sign-in state. */
export const SIGN_IN_CHECK_TIMEOUT_MS = 15_000;

export const IDEA_EXAMPLES: readonly string[] = [
  "Hotel breakfast orders",
  "Maintenance requests",
  "Invoice approvals",
];

/** `$10 to spend`: what is left of the Studio's limit; "" when unknown. */
export function spendText(
  usage: { usageUsd: number; limitUsd: number | null } | null | undefined,
): string {
  if (!usage || usage.limitUsd === null) return "";
  const left = Math.max(0, usage.limitUsd - usage.usageUsd);
  const amount = Number.isInteger(left) ? `$${left}` : `$${left.toFixed(2)}`;
  return `${amount} to spend`;
}

export type IdeaScreenProps = {
  /** Starts the product from the idea; resolves the conversation to open. */
  onStart: (idea: string) => Promise<string | undefined>;
  onStarted: (sessionId: string) => void;
  onOpenSettings: () => void;
};

export function IdeaScreen({
  onStart,
  onStarted,
  onOpenSettings,
}: IdeaScreenProps) {
  const auth = useStudioSignIn();
  const budget = useStudioBudget();
  const toast = usePHToast();
  const [idea, setIdea] = useState("");
  const [starting, setStarting] = useState(false);
  /** Build it was pressed while the sign-in state was still unknown. */
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);
  /** The kept idea is sent at most once per page. */
  const sentRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
          <span>Your build couldn&apos;t start.</span>
          <button
            type="button"
            onClick={() => void start(text)}
            className="rounded px-1.5 py-0.5 font-medium underline"
          >
            Try again
          </button>
        </span>,
        { type: "error" },
      );
    }
  }

  function submit() {
    const text = idea.trim();
    if (!text || starting || awaitingSignIn) return;
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
  const spend = spendText(budget.snapshot.usage);

  return (
    <>
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
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-16">
        <form
          className="flex w-full max-w-2xl flex-col items-center gap-5 text-center"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <VetraMitosis size={48} active={busy} />
          <h1 className="text-2xl font-semibold text-foreground">
            {IDEA_HEADING}
          </h1>
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
            placeholder={IDEA_PLACEHOLDER}
            aria-label="Your idea"
            className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-vetra-primary"
          />
          <button
            type="submit"
            disabled={busy || !idea.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-vetra-primary px-5 py-2 text-sm font-medium text-vetra-primary-fg shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-vetra-primary focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Starting…" : "Build it"}
          </button>
          <div className="flex flex-wrap justify-center gap-2">
            {IDEA_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                disabled={busy}
                onClick={() => fill(example)}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
        </form>
      </div>
    </>
  );
}
