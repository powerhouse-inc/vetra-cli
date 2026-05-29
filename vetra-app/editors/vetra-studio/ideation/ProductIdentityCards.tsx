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
      <h3 className="mb-3 text-base font-semibold text-gray-800">
        Product Identity
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
        className="flex h-28 flex-col justify-between rounded-lg border border-gray-300 bg-white p-4 text-left hover:border-gray-400 hover:shadow-sm"
      >
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        <span className="truncate text-xs text-gray-500">{node.name}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void create()}
      disabled={creating}
      className="flex h-28 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 hover:border-gray-400 disabled:opacity-50"
    >
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <span className="mt-1 text-xs text-gray-500">
        {creating ? "Creating…" : "+ Create"}
      </span>
    </button>
  );
}
