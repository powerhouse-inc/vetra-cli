import { Check, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
    | { kind: "disconnected"; appInstalled: boolean }
    | { kind: "connected"; connection: GithubConnection }
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

  useEffect(() => {
    if (!environmentId || !authorized) return;
    const flags = { cancelled: false };
    const isCancelled = () => flags.cancelled;
    void (async () => {
      const token = await getAuthToken(renown);
      if (!token || isCancelled()) return;
      const result = await myGithubStatus(environmentId, token);
      if (isCancelled()) return;
      if (result?.connected && result.connection) {
        setStatus({ kind: "connected", connection: result.connection });
      } else {
        setStatus({
          kind: "disconnected",
          appInstalled: result?.appInstalled ?? false,
        });
      }
    })();
    return () => {
      flags.cancelled = true;
    };
  }, [environmentId, authorized, renown]);

  if (!environmentId || !authorized) return null;

  if (status.kind === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-muted-foreground">
        <GithubMark size={16} />
        <Loader2 size={14} className="animate-spin" />
      </div>
    );
  }

  if (status.kind === "connected") {
    return <ConnectedRow connection={status.connection} />;
  }

  return (
    <ConnectFlow
      environmentId={environmentId}
      appInstalled={status.appInstalled}
      onConnected={(connection) => setStatus({ kind: "connected", connection })}
    />
  );
}

function ConnectedRow({ connection }: { connection: GithubConnection }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
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
        Manage app
        <ExternalLink size={14} />
      </a>
    </div>
  );
}

function ConnectFlow({
  environmentId,
  appInstalled,
  onConnected,
}: {
  environmentId: string;
  appInstalled: boolean;
  onConnected: (connection: GithubConnection) => void;
}) {
  const { phase, connect, reset } = useGithubConnect(environmentId);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"install" | "form">("install");
  const [repoName, setRepoName] = useState("");

  if (phase.kind === "connected") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4">
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onConnected(phase.connection)}
            className={PRIMARY_BTN}
          >
            <Check size={14} />
            Done
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === "needsInstall") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <GithubMark size={15} />
          Waiting for the app installation…
        </div>
        <p className="text-sm text-muted-foreground">
          You&apos;re authorized, but the Vetra app isn&apos;t installed on
          your GitHub account yet. Install it and this card will continue by
          itself — no need to come back and click anything.
        </p>
        <div className="flex items-center gap-3">
          <a
            href={githubInstallUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className={PRIMARY_BTN}
          >
            <GithubMark size={14} />
            Install the Vetra app
          </a>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Watching for the install…
          </span>
          <button
            type="button"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === "awaiting") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4">
        <p className="text-sm text-muted-foreground">
          Open GitHub and enter this code to authorize Vetra:
        </p>
        <div className="rounded-lg bg-muted px-4 py-3 text-center font-mono text-lg tracking-[0.3em] text-foreground">
          {phase.userCode}
        </div>
        <div className="flex items-center gap-3">
          <a
            href={phase.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className={PRIMARY_BTN}
          >
            <GithubMark size={14} />
            Open GitHub
          </a>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Waiting for authorization…
          </span>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
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
          onClick={() => {
            setOpen(true);
            // Users with the app already installed go straight to the form.
            setStep(appInstalled ? "form" : "install");
          }}
          className={LINK_BTN}
        >
          Connect
        </button>
      </div>
    );
  }

  if (step === "install") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <GithubMark size={15} />
          Step 1 of 2 — Install the Vetra app
        </div>
        <p className="text-sm text-muted-foreground">
          Install the Vetra app on your GitHub account first — GitHub only lets
          it create the studio&apos;s repository once it&apos;s installed.
          &ldquo;All repositories&rdquo; or a selection both work; the new repo
          is added to the installation automatically.
        </p>
        <div className="flex items-center gap-3">
          <a
            href={githubInstallUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className={PRIMARY_BTN}
          >
            <GithubMark size={14} />
            Install the Vetra app
          </a>
          <button
            type="button"
            onClick={() => setStep("form")}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Already installed — continue
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const busy = phase.kind === "starting";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4">
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
      {phase.kind === "error" ? (
        <p className="text-sm text-destructive">{phase.message}</p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || repoName.trim().length === 0}
          onClick={() => {
            void connect(repoName.trim());
          }}
          className={PRIMARY_BTN}
        >
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Starting…
            </>
          ) : (
            <>
              <GithubMark size={14} />
              Connect GitHub
            </>
          )}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
