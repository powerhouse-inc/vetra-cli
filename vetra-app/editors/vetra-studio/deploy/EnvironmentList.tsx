import type { ISigner } from "document-model";
import { Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { loadEnvironmentController } from "./cloudController.js";
import { CLOUD_BASE_DOMAIN } from "./config.js";
import { StatusDot } from "./StatusBadge.js";
import type { EnvironmentSummary } from "./cloudGraphql.js";
import type { EnvironmentsState } from "./useCloudEnvironments.js";
import { errorMessage } from "./utils.js";

export function EnvironmentList({
  state,
  signer,
  driveId,
  onOpen,
  onCreate,
  onRetry,
  onDeleted,
}: {
  state: EnvironmentsState;
  signer: ISigner | null;
  driveId: string;
  onOpen: (id: string, name: string) => void;
  onCreate: () => void;
  onRetry: () => void;
  onDeleted: () => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">
          Environments
        </h3>
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-1.5 rounded-lg bg-vetra-primary px-3 py-1.5 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90"
        >
          <Plus size={15} />
          New environment
        </button>
      </div>

      {state.status === "error" ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card px-4 py-6">
          <p className="text-sm text-destructive">{state.error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="text-sm text-vetra-primary hover:underline"
          >
            Retry
          </button>
        </div>
      ) : state.status === "loading" ? (
        <div className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          Loading environments…
        </div>
      ) : state.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          No environments yet. Create one to deploy your product to the cloud.
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(22rem,1fr))]">
          {state.items.map((env) => (
            <EnvironmentCard
              key={env.id}
              env={env}
              signer={signer}
              driveId={driveId}
              onOpen={onOpen}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EnvironmentCard({
  env,
  signer,
  driveId,
  onOpen,
  onDeleted,
}: {
  env: EnvironmentSummary;
  signer: ISigner | null;
  driveId: string;
  onOpen: (id: string, name: string) => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = env.name?.trim() || env.id;
  const host =
    env.customDomain ??
    (env.subdomain ? `${env.subdomain}.${CLOUD_BASE_DOMAIN}` : null);

  async function handleDelete() {
    if (!signer) {
      setError("Sign in with Renown to delete.");
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const ctrl = await loadEnvironmentController({
        documentId: env.id,
        parentIdentifier: driveId,
        signer,
      });
      await ctrl.delete();
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Server size={16} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-base font-semibold text-foreground">
            {label}
          </span>
        </span>
        <StatusDot status={env.status ?? "DRAFT"} />
      </div>

      {host ? (
        <span className="truncate text-xs text-muted-foreground">{host}</span>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleDelete()}
            className="flex-1 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete environment"}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(env.id, label)}
            className="flex-1 rounded-lg bg-vetra-primary px-4 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90"
          >
            Manage
          </button>
          <button
            type="button"
            aria-label={`Delete ${label}`}
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-border p-2 text-muted-foreground hover:border-destructive hover:text-destructive"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
