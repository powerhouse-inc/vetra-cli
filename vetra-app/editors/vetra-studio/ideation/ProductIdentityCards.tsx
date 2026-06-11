import { addDocument, usePHToast } from "@powerhousedao/reactor-browser";
import type {
  DocumentDriveDocument,
  FileNode,
} from "@powerhousedao/shared/document-drive";
import { useState } from "react";
import type { OpenTarget } from "./types.js";

const IDENTITY = [
  { type: "powerhouse/brand-sheet", label: "Brand Sheet" },
  { type: "powerhouse/problem-sheet", label: "Problem Sheet" },
  { type: "powerhouse/audience-sheet", label: "Audience Sheet" },
];

export function ProductIdentityCards({
  drive,
  onOpen,
}: {
  drive: DocumentDriveDocument;
  onOpen: (target: OpenTarget) => void;
}) {
  const files = drive.state.global.nodes.filter(
    (node): node is FileNode => node.kind === "file",
  );
  return (
    <section>
      <h3 className="mb-3 text-base font-semibold text-vetra-fg">
        Product Identity
      </h3>
      <div className="grid grid-cols-3 gap-4">
        {IDENTITY.map(({ type, label }) => (
          <IdentityCard
            key={type}
            driveId={drive.header.id}
            type={type}
            label={label}
            node={files.find((f) => f.documentType === type)}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}

function IdentityCard({
  driveId,
  type,
  label,
  node,
  onOpen,
}: {
  driveId: string;
  type: string;
  label: string;
  node: FileNode | undefined;
  onOpen: (target: OpenTarget) => void;
}) {
  const [creating, setCreating] = useState(false);
  const toast = usePHToast();

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const created = await addDocument(driveId, label, type);
      onOpen({ id: created.id, documentType: type, name: label });
    } catch (err) {
      toast?.(
        err instanceof Error ? err.message : `Failed to create ${label}`,
        { type: "error" },
      );
    } finally {
      setCreating(false);
    }
  }

  if (node) {
    return (
      <button
        type="button"
        onClick={() =>
          onOpen({ id: node.id, documentType: type, name: node.name })
        }
        className="flex h-28 flex-col justify-between rounded-xl border border-vetra-border bg-vetra-card p-4 text-left transition-colors hover:border-vetra-primary hover:shadow-sm"
      >
        <span className="text-sm font-semibold text-vetra-fg">{label}</span>
        <span className="truncate text-xs text-vetra-muted-fg">{node.name}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void create()}
      disabled={creating}
      className="flex h-28 flex-col items-center justify-center rounded-xl border border-dashed border-vetra-border bg-vetra-accent p-4 transition-colors hover:border-vetra-primary disabled:opacity-50"
    >
      <span className="text-sm font-medium text-vetra-fg">{label}</span>
      <span className="mt-1 text-xs text-vetra-muted-fg">
        {creating ? "Creating…" : "+ Create"}
      </span>
    </button>
  );
}
