import { DocumentStateViewer } from "@powerhousedao/design-system/connect";
import type { PHDocument } from "document-model";

/**
 * Thin, read-mostly editor layout shared by every model editor while the
 * studio is in its skeleton phase: editable document name, header metadata,
 * and the raw state. Per-model field editors replace the body over time.
 */
export function DocumentSkeletonEditor({
  document,
  onRename,
}: {
  document: PHDocument;
  onRename: (name: string) => void;
}) {
  return (
    <div className="ph-default-styles">
      <label className="my-4 block">
        <h3>Document Name</h3>
        <input
          type="text"
          defaultValue={document.header.name}
          placeholder="Enter document name..."
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next && next !== document.header.name) onRename(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="font-semibold"
        />
      </label>
      <hr />
      <div className="my-4 grid grid-cols-2 gap-x-8">
        <label>
          <h3 className="text-base">ID</h3>
          <input
            type="text"
            value={document.header.id}
            readOnly
            className="font-mono"
          />
        </label>
        <label>
          <h3 className="text-base">Type</h3>
          <input type="text" value={document.header.documentType} readOnly />
        </label>
        <label>
          <h3 className="text-base">Created</h3>
          <input
            type="text"
            value={new Date(document.header.createdAtUtcIso).toLocaleString()}
            readOnly
          />
        </label>
        <label>
          <h3 className="text-base">Last Modified</h3>
          <input
            type="text"
            value={new Date(
              document.header.lastModifiedAtUtcIso,
            ).toLocaleString()}
            readOnly
          />
        </label>
      </div>
      <h3 className="text-base">Document State</h3>
      <DocumentStateViewer state={document.state} />
    </div>
  );
}
