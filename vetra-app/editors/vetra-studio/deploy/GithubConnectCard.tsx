import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRenown } from "@powerhousedao/reactor-browser";
import { resolveStudioEnvironmentId } from "../hooks/preview-server-client.js";
import { getAuthToken } from "./cloudClient.js";
import {
  githubInstallUrl,
  myGithubStatus,
  type GithubConnection,
} from "./githubConnect.js";
import { useGithubConnect } from "./useGithubConnect.js";

const LINK_BTN =
  "flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground hover:border-vetra-primary hover:text-vetra-primary";

const PRIMARY_BTN =
  "flex shrink-0 items-center gap-1.5 rounded-lg bg-vetra-primary px-3.5 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90 disabled:cursor-not-allowed disabled:opacity-50";

/** Imperative handle to cancel a pending auto-open (set by AutoOpenNotice,
 * called by the manual open button so the same tab isn't opened twice). */
type AutoOpenCancel = { current: (() => void) | null };

/** Counts down, then opens `url` in a new tab once. The browser may block the
 * open (no fresh user gesture — and with noopener the return value can't tell
 * us), so the post-countdown copy stays neutral and the manual button remains.
 * Clicking the manual button cancels the countdown via `cancelRef`. */
function AutoOpenNotice({
  url,
  pendingLabel,
  openedLabel,
  cancelRef,
}: {
  url: string;
  pendingLabel: (seconds: number) => string;
  openedLabel: string;
  cancelRef: AutoOpenCancel;
}) {
  const [remaining, setRemaining] = useState(5);
  const [cancelled, setCancelled] = useState(false);
  const openedRef = useRef(false);

  useEffect(() => {
    cancelRef.current = () => setCancelled(true);
    return () => {
      cancelRef.current = null;
    };
  }, [cancelRef]);

  useEffect(() => {
    if (cancelled) return;
    if (remaining <= 0) {
      if (!openedRef.current) {
        openedRef.current = true;
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, cancelled, url]);

  if (cancelled) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {remaining > 0 ? pendingLabel(remaining) : openedLabel}
    </p>
  );
}

/** Copies `value` to the clipboard with a brief confirmation state. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-vetra-primary hover:text-vetra-primary"
    >
      {copied ? (
        <Check size={16} className="text-success" />
      ) : (
        <Copy size={16} />
      )}
    </button>
  );
}

/** GitHub mark, inline (this lucide-react version ships no brand icons). */
function GithubMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** The studio's GitHub repo — the durable copy of everything the agent
 * generates, one repo per studio environment. Shows the connected repo, or a
 * device-flow connect to create one. Renders nothing outside a provisioned
 * studio (no environment id) or while signed out. */
export function GithubConnectCard({ authorized }: { authorized: boolean }) {
  const renown = useRenown();
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [status, setStatus] = useState<
    | { kind: "loading" }
    | { kind: "unavailable" }
    | { kind: "disconnected" }
    | {
        kind: "connected";
        connection: GithubConnection;
        repoAccessible: boolean | null;
      }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void resolveStudioEnvironmentId().then((id) => {
      if (!cancelled) setEnvironmentId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!environmentId || !authorized) return;
    const token = await getAuthToken(renown);
    if (!token) return;
    const result = await myGithubStatus(environmentId, token);
    if (result === null) {
      // Fetch failure: never downgrade a known state to "disconnected".
      setStatus((s) => (s.kind === "loading" ? { kind: "unavailable" } : s));
      return;
    }
    if (result.connected && result.connection) {
      setStatus({
        kind: "connected",
        connection: result.connection,
        // Older backends don't return the field — treat as healthy.
        repoAccessible: result.repoAccessible ?? true,
      });
    } else {
      setStatus({ kind: "disconnected" });
    }
  }, [environmentId, authorized, renown]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The user fixes install/access on github.com in another tab; re-check when
  // they come back so the card heals without a manual click.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  if (!environmentId || !authorized) return null;

  if (status.kind === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-muted-foreground">
        <GithubMark size={16} />
        <Loader2 size={14} className="animate-spin" />
      </div>
    );
  }

  if (status.kind === "unavailable") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <GithubMark size={16} />
        <span className="flex-1 text-sm text-muted-foreground">
          Couldn&apos;t check the GitHub connection.
        </span>
        <button
          type="button"
          onClick={() => {
            setStatus({ kind: "loading" });
            void refresh();
          }}
          className={LINK_BTN}
        >
          Try again
        </button>
      </div>
    );
  }

  if (status.kind === "connected") {
    return (
      <ConnectedRow
        connection={status.connection}
        repoAccessible={status.repoAccessible}
        onRefresh={() => void refresh()}
      />
    );
  }

  return (
    <ConnectFlow
      environmentId={environmentId}
      onConnected={(connection) =>
        setStatus({ kind: "connected", connection, repoAccessible: true })
      }
    />
  );
}

function ConnectedRow({
  connection,
  repoAccessible,
  onRefresh,
}: {
  connection: GithubConnection;
  repoAccessible: boolean | null;
  onRefresh: () => void;
}) {
  const degraded = repoAccessible === false;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-3">
        <GithubMark size={16} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <a
            href={connection.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm font-medium text-foreground hover:text-vetra-primary"
          >
            {connection.repoFullName}
          </a>
          <span className="text-xs text-muted-foreground">
            The agent pushes this studio&apos;s work here.
          </span>
        </div>
        <a
          href={githubInstallUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_BTN}
        >
          {degraded ? "Fix access on GitHub" : "Manage app"}
          <ExternalLink size={14} />
        </a>
      </div>
      {degraded ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
          <span className="text-xs text-destructive">
            The Vetra app can&apos;t access this repository — pushes will fail.
            Reinstall the app or add the repository to its access list.
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Check again
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ConnectFlow({
  environmentId,
  onConnected,
}: {
  environmentId: string;
  onConnected: (connection: GithubConnection) => void;
}) {
  const { phase, start, createRepo, reset } = useGithubConnect(environmentId);
  const [open, setOpen] = useState(false);
  const [repoName, setRepoName] = useState("");

  // The journey starts with GitHub authorization, so kick it off the moment
  // the dialog opens — the repo name comes last.
  useEffect(() => {
    if (open && phase.kind === "idle") void start();
  }, [open, phase.kind, start]);

  const close = () => {
    reset();
    setRepoName("");
    setOpen(false);
  };

  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <GithubMark size={16} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            Connect GitHub
          </span>
          <span className="text-xs text-muted-foreground">
            Create a private repository the agent pushes this studio&apos;s work
            to.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={LINK_BTN}
        >
          Connect
        </button>
      </div>
      {open ? (
        <ConnectModal
          phase={phase}
          repoName={repoName}
          setRepoName={setRepoName}
          onSubmit={() => void createRepo(repoName.trim())}
          onRetry={() => void start()}
          onDone={(connection) => {
            onConnected(connection);
            close();
          }}
          onClose={close}
        />
      ) : null}
    </>
  );
}

/** Focused dialog hosting the whole connect journey: authorize (device code)
 * → waiting-for-install if needed (auto-advances) → repo name → created. The
 * flow advances by itself; the only manual actions are GitHub's own pages and
 * the final repo name. */
function ConnectModal({
  phase,
  repoName,
  setRepoName,
  onSubmit,
  onRetry,
  onDone,
  onClose,
}: {
  phase: ReturnType<typeof useGithubConnect>["phase"];
  repoName: string;
  setRepoName: (v: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onDone: (connection: GithubConnection) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect GitHub"
        className="relative z-10 flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-xl"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <GithubMark size={16} />
          Connect GitHub
        </div>
        <ModalBody
          phase={phase}
          repoName={repoName}
          setRepoName={setRepoName}
          onSubmit={onSubmit}
          onRetry={onRetry}
          onDone={onDone}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function ModalBody({
  phase,
  repoName,
  setRepoName,
  onSubmit,
  onRetry,
  onDone,
  onClose,
}: {
  phase: ReturnType<typeof useGithubConnect>["phase"];
  repoName: string;
  setRepoName: (v: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onDone: (connection: GithubConnection) => void;
  onClose: () => void;
}) {
  // Shared by the GitHub-bound steps: the manual open button cancels the
  // pending auto-open so the same page isn't opened twice.
  const autoOpenCancel = useRef<(() => void) | null>(null);

  if (phase.kind === "connected") {
    return (
      <>
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Check size={15} className="text-success" />
          Repository created
        </div>
        <p className="text-sm text-muted-foreground">
          The agent will push this studio&apos;s work to{" "}
          <a
            href={phase.connection.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline"
          >
            {phase.connection.repoFullName}
          </a>
          .
        </p>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => onDone(phase.connection)}
            className={PRIMARY_BTN}
          >
            <Check size={14} />
            Done
          </button>
        </div>
      </>
    );
  }

  if (phase.kind === "waitingInstall") {
    return (
      <>
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Loader2 size={15} className="animate-spin" />
          Waiting for the app installation…
        </div>
        <p className="text-sm text-muted-foreground">
          You&apos;re authorized, but the Vetra app isn&apos;t installed on your
          GitHub account yet. Install it and this dialog will continue by itself
          — nothing to confirm here.
        </p>
        <AutoOpenNotice
          url={githubInstallUrl()}
          pendingLabel={(s) => `Taking you to the app install page in ${s}s…`}
          openedLabel="An install tab should have opened — if it didn't, use the button."
          cancelRef={autoOpenCancel}
        />
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <a
            href={githubInstallUrl()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => autoOpenCancel.current?.()}
            className={PRIMARY_BTN}
          >
            <GithubMark size={14} />
            Install the Vetra app
          </a>
        </div>
      </>
    );
  }

  if (phase.kind === "awaiting") {
    return (
      <>
        <p className="text-sm text-muted-foreground">
          Open GitHub and enter this code to authorize Vetra:
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-lg bg-muted px-4 py-3 text-center font-mono text-lg tracking-[0.3em] text-foreground">
            {phase.userCode}
          </div>
          <CopyButton value={phase.userCode} label="Copy code" />
        </div>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Waiting for authorization…
        </span>
        <AutoOpenNotice
          url={phase.verificationUri}
          pendingLabel={(s) =>
            `Taking you to GitHub in ${s}s to enter the code…`
          }
          openedLabel="A GitHub tab should have opened — if it didn't, use the button."
          cancelRef={autoOpenCancel}
        />
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <a
            href={phase.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => autoOpenCancel.current?.()}
            className={PRIMARY_BTN}
          >
            <GithubMark size={14} />
            Open GitHub
          </a>
        </div>
      </>
    );
  }

  if (phase.kind === "idle" || phase.kind === "starting") {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        Contacting GitHub…
      </span>
    );
  }

  if (phase.kind === "creating") {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        Creating the repository…
      </span>
    );
  }

  if (phase.kind === "error") {
    return (
      <>
        <p className="text-sm text-destructive">{phase.message}</p>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button type="button" onClick={onRetry} className={PRIMARY_BTN}>
            <GithubMark size={14} />
            Try again
          </button>
        </div>
      </>
    );
  }

  // naming — authorized + installed; the repo name is the last step.
  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground">
          Repository name
        </span>
        <input
          value={repoName}
          onChange={(e) => setRepoName(e.target.value)}
          placeholder="my-vetra-studio"
          autoFocus
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-vetra-primary"
        />
        <span className="text-xs text-muted-foreground">
          Created private in your GitHub account; must be unique there.
        </span>
      </label>
      {phase.error ? (
        <p className="text-sm text-destructive">{phase.error}</p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={repoName.trim().length === 0}
          onClick={onSubmit}
          className={PRIMARY_BTN}
        >
          <GithubMark size={14} />
          Create repository
        </button>
      </div>
    </>
  );
}
