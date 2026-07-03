import type { ISigner } from "document-model";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Server,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Project } from "../specify/projects.js";
import { CLOUD_BASE_DOMAIN } from "./config.js";
import {
  deployProject,
  DeployError,
  type DeployPhase,
  type DeployTarget,
} from "./deployProject.js";
import {
  IN_FLIGHT,
  isFailedStatus,
  isLive,
  isPendingApproval,
} from "./envStatus.js";
import type {
  DeployData,
  EnvServiceLink,
  PackageView,
  ProjectEnvDeployment,
} from "./projectDeployments.js";
import { StatusDot } from "./StatusBadge.js";
import type { ReleaseStatus } from "./useReleaseStatuses.js";
import { errorMessage } from "./utils.js";

/** Tracks the single in-flight deploy push: which target (env id or "new") and
 * which step it's on, so only that row shows progress and others disable. */
type Busy = { key: string; phase: DeployPhase } | null;

/** Envs we just deployed to, awaiting the cloud rollout: the version pushed,
 * its label, whether we've seen it go in-flight, and a poll count (safety cap).
 * Keeps the row in a "Deploying…" state until the environment is really live. */
type Pending = Map<
  string,
  { version: string; label: string; sawInFlight: boolean; polls: number }
>;

/** An env whose changes were staged but not approved (the approve was dropped);
 * surfaced with a one-click recovery action. */
type Stuck = { envId: string; label: string } | null;

/** An actionable button rendered inside the error card (e.g. re-auth). */
type ErrorAction = { label: string; onClick: () => void } | null;

/** Secondary (outlined) button/link style, shared by Open and the Visit menu. */
const OPEN_BTN =
  "flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground hover:border-vetra-primary hover:text-vetra-primary";

function phaseLabel(phase: DeployPhase): string {
  if (phase === "publishing") return "Publishing…";
  if (phase === "approving") return "Approving…";
  return "Installing…";
}

/** Home > Deploy > <project>. Lists the user's environments and this project's
 * status in each, with one action per row: deploy (first time), update (a newer
 * version exists), approve (changes staged but not live), or open (already
 * current). Deploying publishes the latest source if needed, installs that
 * version, and approves the change; the row stays in a loading state until the
 * cloud reports the rollout done, and surfaces failures or a stuck approval. */
export function ProjectDeployDetail({
  project,
  pkg,
  release,
  deploy,
  driveId,
  signer,
  onSignIn,
  onRefresh,
  onDeployed,
}: {
  project: Project;
  pkg: PackageView;
  release: ReleaseStatus;
  deploy: DeployData;
  driveId: string;
  signer: ISigner | null;
  onSignIn: () => void;
  /** Re-fetch environments (status) — also used to poll a rollout to done. */
  onRefresh: () => void;
  /** Called after a successful deploy with the version that went live, so the
   * parent re-resolves status and trusts that version over the stale registry. */
  onDeployed: (version: string) => void;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorAction, setErrorAction] = useState<ErrorAction>(null);
  const [done, setDone] = useState<string | null>(null);
  const [stuck, setStuck] = useState<Stuck>(null);
  const [creating, setCreating] = useState(false);
  const [newEnvName, setNewEnvName] = useState(project.name);
  const [pending, setPending] = useState<Pending>(new Map());

  const environments = deploy.kind === "ready" ? deploy.environments : [];
  // Stable dependency for the polling effect: only the watched statuses.
  const statusSig = environments
    .map((d) => `${d.env.id}:${d.env.status ?? ""}`)
    .join(",");

  // Reset transient messages when switching to a different project (the parent
  // reuses this component rather than remounting it).
  useEffect(() => {
    setBusy(null);
    setError(null);
    setErrorAction(null);
    setDone(null);
    setStuck(null);
    setPending(new Map());
    setCreating(false);
    setNewEnvName(project.name);
  }, [project.name]);

  // Hold each just-deployed env in "Deploying…" until the cloud rollout
  // settles, polling status meanwhile, and land on the real outcome: live
  // (success), failed (error), or stuck pending approval (recovery action).
  // Bounded by a poll cap so it can never spin forever.
  useEffect(() => {
    if (pending.size === 0) return;
    const statusById = new Map(
      environments.map((d) => [d.env.id, d.env.status ?? ""]),
    );
    const next: Pending = new Map(pending);
    let mutated = false;
    for (const [id, info] of pending) {
      const status = statusById.get(id) ?? "";
      const sawInFlight = info.sawInFlight || IN_FLIGHT.has(status);
      // Only trust a terminal status once we've observed the rollout go
      // in-flight (or after a few polls, for rollouts too fast to catch);
      // otherwise a stale env list (the pre-deploy status) reads as a false
      // result — e.g. an env that was READY before the deploy.
      const trusted = sawInFlight || info.polls >= 3;
      if (trusted && isLive(status)) {
        next.delete(id);
        mutated = true;
        setError(null);
        setErrorAction(null);
        setStuck(null);
        setDone(
          `Deployed to ${info.label}${info.version ? ` · v${info.version}` : ""} — live.`,
        );
        continue;
      }
      if (trusted && isFailedStatus(status)) {
        next.delete(id);
        mutated = true;
        setDone(null);
        setStuck(null);
        setError(
          `Deployment to ${info.label} failed. Check the environment and try again.`,
        );
        continue;
      }
      // Approve never landed (deployProject already retried once): the env sits
      // in CHANGES_PENDING and never goes in-flight. A couple of grace polls
      // first, so a lagging env list doesn't false-trigger.
      if (isPendingApproval(status) && info.polls >= 2) {
        next.delete(id);
        mutated = true;
        setDone(null);
        setStuck({ envId: id, label: info.label });
        continue;
      }
      if (info.polls >= 30) {
        next.delete(id);
        mutated = true;
      } else if (sawInFlight !== info.sawInFlight) {
        next.set(id, { ...info, sawInFlight });
        mutated = true;
      }
    }
    if (mutated) {
      setPending(next);
      return;
    }
    const t = setTimeout(() => {
      setPending((prev) => {
        const m: Pending = new Map();
        for (const [id, info] of prev)
          m.set(id, { ...info, polls: info.polls + 1 });
        return m;
      });
      onRefresh();
    }, 3000);
    return () => clearTimeout(t);
    // statusSig is the stable projection of `environments` this effect reads.
  }, [pending, statusSig, onRefresh]);

  function clearMessages() {
    setError(null);
    setErrorAction(null);
    setDone(null);
    setStuck(null);
  }

  async function run(target: DeployTarget, key: string, label: string) {
    if (!signer) {
      setError("Sign in with Renown to deploy.");
      setErrorAction({ label: "Connect with Renown", onClick: onSignIn });
      return;
    }
    clearMessages();
    setBusy({ key, phase: "publishing" });
    try {
      const outcome = await deployProject({
        project: project.name,
        driveId,
        signer,
        target,
        onPhase: (phase) => setBusy({ key, phase }),
      });
      setBusy(null);
      setCreating(false);
      // The package landed; trust its version and refresh regardless of whether
      // the approve stuck.
      onDeployed(outcome.version);
      if (isPendingApproval(outcome.status)) {
        setStuck({ envId: outcome.envId, label });
        return;
      }
      setDone(
        outcome.published
          ? `Published ${outcome.packageName}@${outcome.version} — deploying to ${label}…`
          : `Deploying ${outcome.packageName}@${outcome.version} to ${label}…`,
      );
      setPending((prev) =>
        new Map(prev).set(outcome.envId, {
          version: outcome.version,
          label,
          sawInFlight: false,
          polls: 0,
        }),
      );
    } catch (err) {
      setBusy(null);
      if (err instanceof DeployError && err.kind === "auth-required") {
        setError("Your Renown session expired. Sign in again to deploy.");
        setErrorAction({ label: "Connect with Renown", onClick: onSignIn });
        return;
      }
      setError(errorMessage(err));
    }
  }

  // Every environment runs the latest and nothing is rolling out.
  const allUpToDate =
    deploy.kind === "ready" &&
    environments.length > 0 &&
    pending.size === 0 &&
    !stuck &&
    environments.every((d) => d.state === "live-current");

  // Where the project is already installed vs. the rest.
  const deployedEnvs = environments.filter((d) => d.installed);
  const otherEnvs = environments.filter((d) => !d.installed);

  const renderEnvList = (envs: ProjectEnvDeployment[]) => (
    <div className="rounded-xl border border-border bg-card">
      {envs.map((d, i) => {
        const status = d.env.status ?? "";
        const watching = pending.has(d.env.id);
        return (
          <EnvRow
            key={d.env.id}
            d={d}
            release={release}
            first={i === 0}
            busyPhase={busy?.key === d.env.id ? busy.phase : null}
            rollingOut={watching || IN_FLIGHT.has(status)}
            needsApproval={!watching && isPendingApproval(status)}
            disabled={busy !== null}
            onDeploy={() => {
              void run(
                {
                  kind: "existing",
                  envId: d.env.id,
                  alreadyInstalled: d.installed,
                },
                d.env.id,
                d.env.name?.trim() || d.env.id,
              );
            }}
          />
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">
          Deploy {project.name}
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose where this app runs. Deploying makes your latest work live
          there.
        </p>
      </div>

      {error ? (
        <div className="max-h-40 overflow-auto rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <pre className="whitespace-pre-wrap break-words font-sans">
            {error}
          </pre>
          {errorAction ? (
            <button
              type="button"
              onClick={errorAction.onClick}
              className="mt-2 rounded-lg bg-vetra-primary px-3 py-1.5 text-xs font-medium text-vetra-primary-fg hover:bg-vetra-primary/90"
            >
              {errorAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
      {stuck ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            {project.name} isn&apos;t live on {stuck.label} yet — its changes
            are staged but not approved. Approve to finish deploying.
          </span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              const env = environments.find((e) => e.env.id === stuck.envId);
              void run(
                {
                  kind: "existing",
                  envId: stuck.envId,
                  alreadyInstalled: env?.installed ?? false,
                },
                stuck.envId,
                stuck.label,
              );
            }}
            className="flex items-center gap-1.5 rounded-lg bg-vetra-primary px-3.5 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Rocket size={14} />
            Approve &amp; deploy
          </button>
        </div>
      ) : null}
      {done ? (
        <p className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 px-4 py-3 text-sm text-success">
          <Check size={15} className="shrink-0" />
          {done}
        </p>
      ) : null}
      {allUpToDate && !done ? (
        <p className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 px-4 py-3 text-sm text-success">
          <Check size={15} className="shrink-0" />
          All environments are up to date — nothing to deploy.
        </p>
      ) : null}

      {deploy.kind === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : deploy.kind === "unauthenticated" ? (
        <UnauthCard onSignIn={onSignIn} />
      ) : deploy.kind === "error" ? (
        <ErrorCard message={deploy.message} onRetry={onRefresh} />
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              {deployedEnvs.length > 0
                ? "Deployed on:"
                : "Available environments"}
            </h3>
            {pkg.status === "ready" ? (
              <span className="font-mono text-xs text-muted-foreground">
                {pkg.name}@{pkg.version}
              </span>
            ) : null}
          </div>

          {environments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-accent px-4 py-6 text-sm text-muted-foreground">
              This app isn&apos;t running anywhere yet. Create an environment to
              put it online.
            </div>
          ) : deployedEnvs.length === 0 ? (
            renderEnvList(environments)
          ) : (
            <>
              {renderEnvList(deployedEnvs)}
              {otherEnvs.length > 0 ? (
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Other environments
                  </h3>
                  {renderEnvList(otherEnvs)}
                </div>
              ) : null}
            </>
          )}

          {creating ? (
            <NewEnvironmentRow
              value={newEnvName}
              busy={busy?.key === "new" ? busy.phase : null}
              disabled={busy !== null}
              onChange={setNewEnvName}
              onCreate={() => {
                void run(
                  { kind: "new", label: newEnvName.trim() },
                  "new",
                  newEnvName.trim(),
                );
              }}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                clearMessages();
                setCreating(true);
              }}
              className="flex items-center justify-center gap-1.5 self-start rounded-lg border border-dashed border-border px-4 py-2 text-sm font-medium text-foreground hover:border-vetra-primary hover:text-vetra-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={15} />
              New environment
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function EnvRow({
  d,
  release,
  first,
  busyPhase,
  rollingOut,
  needsApproval,
  disabled,
  onDeploy,
}: {
  d: ProjectEnvDeployment;
  release: ReleaseStatus;
  first: boolean;
  busyPhase: DeployPhase | null;
  rollingOut: boolean;
  needsApproval: boolean;
  disabled: boolean;
  onDeploy: () => void;
}) {
  const label = d.env.name?.trim() || d.env.id;
  return (
    <div
      className={`flex items-center gap-4 px-4 py-3.5 ${
        first ? "" : "border-t border-border"
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Server size={16} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {label}
          </span>
          <StatusDot status={d.env.status ?? "DRAFT"} />
        </div>
        {d.url ? (
          <span className="truncate text-xs text-muted-foreground">{d.url}</span>
        ) : null}
        <ProjectStatusLine
          d={d}
          release={release}
          rollingOut={rollingOut}
          needsApproval={needsApproval}
        />
      </div>

      <EnvAction
        d={d}
        busyPhase={busyPhase}
        rollingOut={rollingOut}
        needsApproval={needsApproval}
        disabled={disabled}
        onDeploy={onDeploy}
      />
    </div>
  );
}

/** Per-place freshness in plain language; a rollout or pending approval wins. */
function ProjectStatusLine({
  d,
  release,
  rollingOut,
  needsApproval,
}: {
  d: ProjectEnvDeployment;
  release: ReleaseStatus;
  rollingOut: boolean;
  needsApproval: boolean;
}) {
  if (rollingOut) {
    return (
      <span className="text-xs text-muted-foreground">
        {d.installedVersion
          ? `Rolling out v${d.installedVersion}…`
          : "Rolling out…"}
      </span>
    );
  }
  if (needsApproval) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
        Changes pending approval
      </span>
    );
  }
  if (d.state === "not-deployed") {
    return (
      <span className="text-xs text-muted-foreground">Not deployed here</span>
    );
  }
  if (d.state === "update-available") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
        Update available
        {d.installedVersion ? (
          <span className="font-normal text-muted-foreground">
            · running v{d.installedVersion}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
      {release.known ? "Up to date" : "Deployed"}
      {d.installedVersion ? (
        <span className="font-normal">· v{d.installedVersion}</span>
      ) : null}
    </span>
  );
}

function EnvAction({
  d,
  busyPhase,
  rollingOut,
  needsApproval,
  disabled,
  onDeploy,
}: {
  d: ProjectEnvDeployment;
  busyPhase: DeployPhase | null;
  rollingOut: boolean;
  needsApproval: boolean;
  disabled: boolean;
  onDeploy: () => void;
}) {
  if (busyPhase) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-vetra-primary px-3.5 py-2 text-sm font-medium text-vetra-primary-fg opacity-80">
        <Loader2 size={14} className="animate-spin" />
        {phaseLabel(busyPhase)}
      </span>
    );
  }
  if (rollingOut) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        Deploying…
      </span>
    );
  }
  if (needsApproval) {
    // The env has staged changes awaiting approval. Run the full deploy so this
    // project's package is installed before we approve — approving alone would
    // roll the env out without it.
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onDeploy}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-vetra-primary px-3.5 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Rocket size={14} />
        Approve &amp; deploy
      </button>
    );
  }
  if (d.state === "live-current") {
    return <VisitMenu services={d.services} fallbackUrl={d.url} />;
  }
  const isUpdate = d.state === "update-available";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onDeploy}
      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-vetra-primary px-3.5 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isUpdate ? <RefreshCw size={14} /> : <Rocket size={14} />}
      {isUpdate ? "Update" : "Deploy"}
    </button>
  );
}

/** Open the running app. The apex domain serves nothing — the services do — so
 * this opens a specific service: a direct link when there's one, a dropdown to
 * pick (Connect / Switchboard / …) when there are several. */
function VisitMenu({
  services,
  fallbackUrl,
}: {
  services: EnvServiceLink[];
  fallbackUrl: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (services.length === 0) {
    return fallbackUrl ? (
      <a
        href={`https://${fallbackUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        className={OPEN_BTN}
      >
        Open
        <ExternalLink size={14} />
      </a>
    ) : (
      <span className="shrink-0 text-xs text-muted-foreground">Up to date</span>
    );
  }

  if (services.length === 1) {
    return (
      <a
        href={services[0].url}
        target="_blank"
        rel="noopener noreferrer"
        className={OPEN_BTN}
      >
        Open
        <ExternalLink size={14} />
      </a>
    );
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={OPEN_BTN}
      >
        Open
        <ChevronDown
          size={14}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 min-w-44 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-md">
            {services.map((s) => (
              <a
                key={s.type}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-4 px-3 py-1.5 text-sm text-foreground hover:bg-accent"
              >
                {s.label}
                <ExternalLink size={13} className="text-muted-foreground" />
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function NewEnvironmentRow({
  value,
  busy,
  disabled,
  onChange,
  onCreate,
  onCancel,
}: {
  value: string;
  busy: DeployPhase | null;
  disabled: boolean;
  onChange: (v: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-accent px-4 py-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground">
          New environment name
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="My product"
          autoFocus
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-vetra-primary"
        />
        <span className="text-xs text-muted-foreground">
          A {CLOUD_BASE_DOMAIN} subdomain is assigned automatically.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || value.trim().length === 0}
          onClick={onCreate}
          className="flex items-center gap-1.5 rounded-lg bg-vetra-primary px-3.5 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {busy === "publishing" ? "Publishing…" : "Creating…"}
            </>
          ) : (
            <>
              <Rocket size={14} />
              Create &amp; deploy
            </>
          )}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onCancel}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function UnauthCard({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card px-4 py-6">
      <p className="text-sm text-muted-foreground">
        Sign in with Renown to deploy this project.
      </p>
      <button
        type="button"
        onClick={onSignIn}
        className="rounded-lg bg-vetra-primary px-3 py-1.5 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90"
      >
        Connect with Renown
      </button>
    </div>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card px-4 py-6">
      <p className="text-sm text-destructive">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm text-vetra-primary hover:underline"
      >
        Retry
      </button>
    </div>
  );
}
