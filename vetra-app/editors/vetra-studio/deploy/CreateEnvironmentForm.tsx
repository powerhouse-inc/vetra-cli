import { TextInput } from "@powerhousedao/document-engineering/ui";
import type { ISigner } from "document-model";
import { useState } from "react";
import { createNewEnvironmentController } from "./cloudController.js";
import { CLOUD_BASE_DOMAIN, CLOUD_DEFAULT_PACKAGE_REGISTRY } from "./config.js";
import { generateSubdomain } from "./subdomain.js";
import { errorMessage } from "./utils.js";

export function CreateEnvironmentForm({
  driveId,
  signer,
  onCreated,
  onCancel,
}: {
  driveId: string;
  signer: ISigner | null;
  onCreated: (id: string, name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      if (!signer) throw new Error("You must be signed in with Renown.");
      const ownerAddress = signer.user?.address;
      if (!ownerAddress) {
        throw new Error("Signer has no user address — cannot claim ownership.");
      }
      const label = name.trim();
      // Subdomain is auto-generated, matching vetra.to: a memorable
      // adjective-animal prefix plus a collision-proof suffix.
      const subdomain = generateSubdomain(crypto.randomUUID());
      const controller = createNewEnvironmentController({
        parentIdentifier: driveId,
        signer,
      });
      // setOwner first — every subsequent action is owner-gated on the remote.
      controller.setOwner({ address: ownerAddress });
      controller.setLabel({ label });
      controller.initialize({
        genericSubdomain: subdomain,
        genericBaseDomain: CLOUD_BASE_DOMAIN,
        defaultPackageRegistry: CLOUD_DEFAULT_PACKAGE_REGISTRY,
      });
      controller.enableService({ type: "CONNECT", prefix: "connect" });
      const result = await controller.push();
      onCreated(result.remoteDocument.id, label);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-vetra-border bg-vetra-card p-6">
      <h3 className="text-base font-semibold text-vetra-fg">New environment</h3>

      <TextInput
        name="name"
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="My product"
        description={`A ${CLOUD_BASE_DOMAIN} subdomain is assigned automatically.`}
        autoFocus
      />

      {error ? <p className="text-sm text-vetra-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          className="rounded-lg bg-vetra-primary px-4 py-2 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create environment"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-sm text-vetra-muted-fg hover:text-vetra-fg"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
