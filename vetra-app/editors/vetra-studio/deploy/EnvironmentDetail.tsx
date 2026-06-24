import { TextInput } from "@powerhousedao/document-engineering/ui";
import type { ISigner } from "document-model";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Server,
  Trash2,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { VetraCloudEnvironmentGlobalState } from "@powerhousedao/vetra-cloud-package/document-models/vetra-cloud-environment";
import type { EnvironmentController } from "./cloudController.js";
import {
  CLOUD_BASE_DOMAIN,
  MANAGEABLE_SERVICES,
  VETRA_CLOUD_APP_URL,
  type CloudServiceType,
} from "./config.js";
import { StatusBadge } from "./StatusBadge.js";
import { useEnvironmentController } from "./useEnvironmentController.js";
import { errorMessage } from "./utils.js";

/** Terminal/destroying statuses where editing makes no sense. Deploying states
 * (DEPLOYING / CHANGES_PUSHED) stay editable — the cloud accepts edits and
 * re-deploys, matching vetra.to. */
const READ_ONLY_STATUSES = new Set(["TERMINATING", "DESTROYED", "ARCHIVED"]);

const SERVICE_META: Record<
  CloudServiceType,
  { name: string; Icon: LucideIcon; suffix: string }
> = {
  CONNECT: { name: "Powerhouse Connect", Icon: Globe, suffix: "" },
  SWITCHBOARD: {
    name: "Powerhouse Switchboard",
    Icon: Server,
    suffix: "/graphql",
  },
  FUSION: { name: "Powerhouse Fusion", Icon: Zap, suffix: "" },
};

export function EnvironmentDetail({
  documentId,
  driveId,
  signer,
}: {
  documentId: string;
  driveId: string;
  signer: ISigner | null;
}) {
  const { controller, state, isLoading, error } = useEnvironmentController(
    documentId,
    driveId,
    signer,
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading environment…</p>
    );
  }
  if (error) {
    return <p className="text-sm text-destructive">{error.message}</p>;
  }
  if (!controller || !state) {
    return (
      <p className="text-sm text-muted-foreground">Environment not found.</p>
    );
  }

  function mutate(apply: (c: EnvironmentController) => void): void {
    const c = controller;
    if (!c) return;
    setBusy(true);
    setActionError(null);
    void (async () => {
      try {
        apply(c);
        await c.push();
      } catch (err) {
        setActionError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    })();
  }

  const readOnly = READ_ONLY_STATUSES.has(state.status);

  return (
    <div className="flex flex-col gap-6">
      <Header state={state} documentId={documentId} />
      {actionError ? (
        <p className="text-sm text-destructive">{actionError}</p>
      ) : null}
      {readOnly ? (
        <p className="text-sm text-muted-foreground">
          This environment is {state.status.replace(/_/g, " ").toLowerCase()}{" "}
          and can't be edited right now.
        </p>
      ) : (
        <fieldset disabled={busy} className="flex flex-col gap-6">
          <LabelField state={state} mutate={mutate} />
          <ServicesSection state={state} mutate={mutate} />
          <PackagesSection state={state} mutate={mutate} />
          <StatusActions state={state} mutate={mutate} />
        </fieldset>
      )}
    </div>
  );
}

type Mutate = (apply: (c: EnvironmentController) => void) => void;

function Header({
  state,
  documentId,
}: {
  state: VetraCloudEnvironmentGlobalState;
  documentId: string;
}) {
  const host =
    state.genericSubdomain && state.genericBaseDomain
      ? `${state.genericSubdomain}.${state.genericBaseDomain}`
      : state.genericSubdomain;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-foreground">
              {state.label?.trim() || host || "Environment"}
            </h2>
            <StatusBadge status={state.status} />
          </div>
          {host ? (
            <span className="font-mono text-sm text-muted-foreground">
              {host}
            </span>
          ) : null}
        </div>
        <a
          href={`${VETRA_CLOUD_APP_URL}/user/environments/${documentId}`}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:border-vetra-primary hover:text-vetra-primary"
        >
          <ExternalLink size={14} />
          Open in Vetra Cloud
        </a>
      </div>
      {state.owner ? (
        <span className="font-mono text-xs text-muted-foreground">
          owner {state.owner}
        </span>
      ) : null}
    </div>
  );
}

function LabelField({
  state,
  mutate,
}: {
  state: VetraCloudEnvironmentGlobalState;
  mutate: Mutate;
}) {
  const [label, setLabel] = useState(state.label ?? "");
  const dirty = label.trim() !== (state.label ?? "").trim() && label.trim();
  return (
    <Section title="Name">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <TextInput
            name="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => mutate((c) => c.setLabel({ label: label.trim() }))}
          className="rounded-lg bg-vetra-primary px-3 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </Section>
  );
}

function ServicesSection({
  state,
  mutate,
}: {
  state: VetraCloudEnvironmentGlobalState;
  mutate: Mutate;
}) {
  const base = state.genericBaseDomain ?? CLOUD_BASE_DOMAIN;
  const subdomain = state.genericSubdomain;
  return (
    <Section title="Services">
      <div className="flex flex-col gap-3">
        {MANAGEABLE_SERVICES.map(({ type, prefix: defaultPrefix }) => {
          const svc = state.services.find((s) => s.type === type);
          const enabled = svc?.enabled ?? false;
          const prefix = svc?.prefix ?? defaultPrefix;
          const meta = SERVICE_META[type];
          const host = subdomain
            ? `${prefix}.${subdomain}.${base}${meta.suffix}`
            : null;
          const Icon = meta.Icon;
          return (
            <div
              key={type}
              className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${
                enabled
                  ? "border-success/40 bg-success/5"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    enabled
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon size={16} />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {meta.name}
                    {!enabled ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        Off
                      </span>
                    ) : null}
                  </span>
                  {host ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {host}
                      </span>
                      <CopyButton value={`https://${host}`} />
                    </span>
                  ) : null}
                </div>
              </div>
              <Toggle
                checked={enabled}
                onChange={() =>
                  mutate((c) =>
                    enabled
                      ? c.disableService({ type })
                      : c.enableService({ type, prefix }),
                  )
                }
              />
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function PackagesSection({
  state,
  mutate,
}: {
  state: VetraCloudEnvironmentGlobalState;
  mutate: Mutate;
}) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  return (
    <Section title="Packages">
      <div className="flex flex-col gap-3">
        {state.packages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No packages installed yet — add one to extend Switchboard or
            Connect.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {state.packages.map((pkg) => (
              <div
                key={pkg.name}
                className="flex items-center justify-between border-b border-border/40 px-4 py-2.5 last:border-b-0"
              >
                <span className="truncate font-mono text-sm text-foreground">
                  {pkg.name}
                  {pkg.version ? (
                    <span className="text-muted-foreground">
                      @{pkg.version}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${pkg.name}`}
                  onClick={() =>
                    mutate((c) => c.removePackage({ packageName: pkg.name }))
                  }
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <TextInput
              name="packageName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="package name"
            />
          </div>
          <div className="w-28">
            <TextInput
              name="packageVersion"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="version"
            />
          </div>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              const packageName = name.trim();
              const v = version.trim();
              mutate((c) =>
                c.addPackage({ packageName, version: v || undefined }),
              );
              setName("");
              setVersion("");
            }}
            className="rounded-lg bg-vetra-primary px-3 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </Section>
  );
}

function StatusActions({
  state,
  mutate,
}: {
  state: VetraCloudEnvironmentGlobalState;
  mutate: Mutate;
}) {
  const canApprove =
    state.status === "DRAFT" || state.status === "CHANGES_PENDING";
  return (
    <Section title="Deployment">
      <div className="flex items-center gap-3">
        {canApprove ? (
          <button
            type="button"
            onClick={() => mutate((c) => c.approveChanges({}))}
            className="rounded-lg bg-vetra-primary px-4 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90"
          >
            Approve changes
          </button>
        ) : (
          <span className="text-sm text-muted-foreground">
            No pending changes to approve.
          </span>
        )}
        <button
          type="button"
          onClick={() => mutate((c) => c.terminateEnvironment({}))}
          className="rounded-lg border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          Terminate
        </button>
      </div>
    </Section>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-success" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy URL"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}
