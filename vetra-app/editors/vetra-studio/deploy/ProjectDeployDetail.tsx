import type { ISigner } from "document-model";
import {
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
  type DeployPhase,
  type DeployTarget,
} from "./deployProject.js";
import type {
  DeployData,
  EnvServiceLink,
  PackageView,
  ProjectEnvDeployment,
} from "./projectDeployments.js";
import { StatusDot } from "./StatusBadge.js";
import type { ReleaseStatus } from "./useReleaseStatuses.js";

/** Tracks the single in-flight deploy push: which target (env id or "new") and
 * which step it's on, so only that row shows progress and others disable. */
type Busy = { key: string; phase: DeployPhase } | null;

/** Env lifecycle statuses that mean a rollout is still in progress. */
const IN_FLIGHT = new Set([
  "CHANGES_PENDING",
  "CHANGES_APPROVED",
  "CHANGES_PUSHED",
  "DEPLOYING",
  "TERMINATING",
]);

/** Envs we just deployed to, awaiting the cloud rollout: the version pushed,
 * whether we've seen it go in-flight, and a poll count (safety cap). Keeps the
 * row in a "Deploying…" state until the environment is really live. */
type Pending = Map<
  string,
  { version: string; sawInFlight: boolean; polls: number }
>;

/** Secondary (outlined) button/link style, shared by Open and the Visit menu. */
const OPEN_BTN =
  "flex shrink-0 items-center gap-1.5 rounded-lg border border-vetra-border px-3.5 py-2 text-sm font-medium text-vetra-fg hover:border-vetra-primary hover:text-vetra-primary";

/** Home > Deploy > <project>. Lists the user's environments and this project's
 * status in each, with one action per row: deploy (first time), update (a newer
 * version exists), or open (already current). Deploying publishes the latest
 * source if needed, installs that version, and approves the change; the row
 * stays in a loading state until the cloud reports the rollout done. */
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
  const [done, setDone] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newEnvName, setNewEnvName] = useState(project.name);
  const [pending, setPending] = useState<Pending>(new Map());

  const environments = deploy.kind === "ready" ? deploy.environments : [];
  // Stable dependency for the polling effect: only the watched statuses.
  const statusSig = environments
    .map((d) => `${d.env.id}:${d.env.status ?? ""}`)
    .join(",");

  // Hold each just-deployed env in "Deploying…" until the cloud rollout
  // settles (seen in-flight then back to a terminal status), polling status
  // meanwhile. Bounded by a poll cap so it can never spin forever.
  useEffect(() => {
    if (pending.size === 0) return;
    const statusById = new Map(
      environments.map((d) => [d.env.id, d.env.status ?? ""]),
    );
    const next: Pending = new Map(pending);
    let mutated = false;
    for (const [id, info] of pending) {
      const status = statusById.get(id);
      const sawInFlight =
        info.sawInFlight || (status ? IN_FLIGHT.has(status) : false);
      const settled = !!status && !IN_FLIGHT.has(status);
      const finished =
        (settled && (sawInFlight || info.polls >= 3)) || info.polls >= 30;
      if (finished) {
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

  async function run(target: DeployTarget, key: string, label: string) {
    if (!signer) {
      setError("Sign in with Renown to deploy.");
      return;
    }
    setError(null);
    setDone(null);
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
      setDone(
        outcome.published
          ? `Published ${outcome.packageName}@${outcome.version} and deployed to ${label}.`
          : `Deployed ${outcome.packageName}@${outcome.version} to ${label}.`,
      );
      setPending((prev) =>
        new Map(prev).set(outcome.envId, {
          version: outcome.version,
          sawInFlight: false,
          polls: 0,
        }),
      );
      onDeployed(outcome.version);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Every environment runs the latest and nothing is rolling out.
  const allUpToDate =
    deploy.kind === "ready" &&
    environments.length > 0 &&
    pending.size === 0 &&
    environments.every((d) => d.state === "live-current");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-vetra-fg">
          Deploy {project.name}
        </h2>
        <p className="text-sm text-vetra-muted-fg">
          Choose where this app runs. Deploying makes your latest work live
          there.
        </p>
      </div>

      {error ? (
        <div className="max-h-40 overflow-auto rounded-lg border border-vetra-destructive/40 bg-vetra-destructive/5 px-4 py-3 text-sm text-vetra-destructive">
          <pre className="whitespace-pre-wrap break-words font-sans">
            {error}
          </pre>
        </div>
      ) : null}
      {done ? (
        <p className="flex items-center gap-2 rounded-lg border border-vetra-success/40 bg-vetra-success/5 px-4 py-3 text-sm text-vetra-success">
          <Check size={15} className="shrink-0" />
          {done}
        </p>
      ) : null}
      {allUpToDate && !done ? (
        <p className="flex items-center gap-2 rounded-lg border border-vetra-success/40 bg-vetra-success/5 px-4 py-3 text-sm text-vetra-success">
          <Check size={15} className="shrink-0" />
          All environments are up to date — nothing to deploy.
        </p>
      ) : null}

      {deploy.kind === "loading" ? (
        <p className="text-sm text-vetra-muted-fg">Loading…</p>
      ) : deploy.kind === "unauthenticated" ? (
        <UnauthCard onSignIn={onSignIn} />
      ) : deploy.kind === "error" ? (
        <ErrorCard message={deploy.message} onRetry={onRefresh} />
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-vetra-fg">
              Where it runs
            </h3>
            {pkg.status === "ready" ? (
              <span className="font-mono text-xs text-vetra-muted-fg">
                {pkg.name}@{pkg.version}
              </span>
            ) : null}
          </div>

          {environments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-vetra-border bg-vetra-accent px-4 py-6 text-sm text-vetra-muted-fg">
              This app isn&apos;t running anywhere yet. Create an environment to
              put it online.
            </div>
          ) : (
            <div className="rounded-xl border border-vetra-border bg-vetra-card">
              {environments.map((d, i) => (
                <EnvRow
                  key={d.env.id}
                  d={d}
                  release={release}
                  first={i === 0}
                  busyPhase={busy?.key === d.env.id ? busy.phase : null}
                  deploying={
                    pending.has(d.env.id) || IN_FLIGHT.has(d.env.status ?? "")
                  }
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
              ))}
            </div>
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
                setDone(null);
                setCreating(true);
              }}
              className="flex items-center justify-center gap-1.5 self-start rounded-lg border border-dashed border-vetra-border px-4 py-2 text-sm font-medium text-vetra-fg hover:border-vetra-primary hover:text-vetra-primary disabled:cursor-not-allowed disabled:opacity-50"
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
  deploying,
  disabled,
  onDeploy,
}: {
  d: ProjectEnvDeployment;
  release: ReleaseStatus;
  first: boolean;
  busyPhase: DeployPhase | null;
  deploying: boolean;
  disabled: boolean;
  onDeploy: () => void;
}) {
  const label = d.env.name?.trim() || d.env.id;
  return (
    <div
      className={`flex items-center gap-4 px-4 py-3.5 ${
        first ? "" : "border-t border-vetra-border"
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-vetra-muted text-vetra-muted-fg">
        <Server size={16} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-vetra-fg">
            {label}
          </span>
          <StatusDot status={d.env.status ?? "DRAFT"} />
        </div>
        {d.url ? (
          <span className="truncate text-xs text-vetra-muted-fg">{d.url}</span>
        ) : null}
        <ProjectStatusLine d={d} release={release} deploying={deploying} />
      </div>

      <EnvAction
        d={d}
        busyPhase={busyPhase}
        deploying={deploying}
        disabled={disabled}
        onDeploy={onDeploy}
      />
    </div>
  );
}

/** Per-place freshness in plain language; a rollout in progress wins. */
function ProjectStatusLine({
  d,
  release,
  deploying,
}: {
  d: ProjectEnvDeployment;
  release: ReleaseStatus;
  deploying: boolean;
}) {
  if (deploying) {
    return (
      <span className="text-xs text-vetra-muted-fg">
        {d.installedVersion
          ? `Rolling out v${d.installedVersion}…`
          : "Rolling out…"}
      </span>
    );
  }
  if (d.state === "not-deployed") {
    return (
      <span className="text-xs text-vetra-muted-fg">Not deployed here</span>
    );
  }
  if (d.state === "update-available") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-vetra-warning">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-vetra-warning" />
        Update available
        {d.installedVersion ? (
          <span className="font-normal text-vetra-muted-fg">
            · running v{d.installedVersion}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-vetra-muted-fg">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-vetra-success" />
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
  deploying,
  disabled,
  onDeploy,
}: {
  d: ProjectEnvDeployment;
  busyPhase: DeployPhase | null;
  deploying: boolean;
  disabled: boolean;
  onDeploy: () => void;
}) {
  if (busyPhase) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-vetra-primary px-3.5 py-2 text-sm font-medium text-vetra-primary-fg opacity-80">
        <Loader2 size={14} className="animate-spin" />
        {busyPhase === "publishing" ? "Publishing…" : "Installing…"}
      </span>
    );
  }
  if (deploying) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-vetra-border px-3.5 py-2 text-sm font-medium text-vetra-muted-fg">
        <Loader2 size={14} className="animate-spin" />
        Deploying…
      </span>
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
      <span className="shrink-0 text-xs text-vetra-muted-fg">Up to date</span>
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
          <div className="absolute right-0 top-full z-20 mt-1 min-w-44 overflow-hidden rounded-lg border border-vetra-border bg-vetra-card py-1 shadow-md">
            {services.map((s) => (
              <a
                key={s.type}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-4 px-3 py-1.5 text-sm text-vetra-fg hover:bg-vetra-accent"
              >
                {s.label}
                <ExternalLink size={13} className="text-vetra-muted-fg" />
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
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-vetra-border bg-vetra-accent px-4 py-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-vetra-fg">
          New environment name
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="My product"
          autoFocus
          className="rounded-lg border border-vetra-border bg-vetra-card px-3 py-2 text-sm text-vetra-fg outline-none focus:border-vetra-primary"
        />
        <span className="text-xs text-vetra-muted-fg">
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
          className="text-sm text-vetra-muted-fg hover:text-vetra-fg disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function UnauthCard({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-vetra-border bg-vetra-card px-4 py-6">
      <p className="text-sm text-vetra-muted-fg">
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
    <div className="flex flex-col items-start gap-2 rounded-xl border border-vetra-border bg-vetra-card px-4 py-6">
      <p className="text-sm text-vetra-destructive">{message}</p>
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
