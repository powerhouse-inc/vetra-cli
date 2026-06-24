import type {
  DocumentDriveDocument,
  FileNode,
} from "@powerhousedao/shared/document-drive";
import { useFeatureDocumentById } from "document-models/feature";
import type { OpenTarget } from "./types.js";

const FEATURE_TYPE = "powerhouse/feature";
const WBS_TYPE = "powerhouse/work-breakdown-structure";

export function FeatureList({
  drive,
  onOpen,
}: {
  drive: DocumentDriveDocument;
  onOpen: (target: OpenTarget) => void;
}) {
  const features = drive.state.global.nodes.filter(
    (node): node is FileNode =>
      node.kind === "file" && (node as FileNode).documentType === FEATURE_TYPE,
  );
  return (
    <section>
      <h3 className="mb-3 text-base font-semibold text-foreground">Features</h3>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-accent px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Feature title, status, scope</span>
          <span>WBS</span>
        </div>
        {features.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No features yet.
          </div>
        ) : (
          features.map((feature) => (
            <FeatureRow
              key={feature.id}
              id={feature.id}
              name={feature.name}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </section>
  );
}

function FeatureRow({
  id,
  name,
  onOpen,
}: {
  id: string;
  name: string;
  onOpen: (target: OpenTarget) => void;
}) {
  const [feature] = useFeatureDocumentById(id);
  const status = feature?.state.global.status;
  const scope = feature?.state.global.scope;
  const wbs = feature?.state.global.wbs;

  return (
    <div className="flex items-center justify-between border-b border-border/40 px-4 py-3 last:border-b-0 hover:bg-accent">
      <button
        type="button"
        onClick={() => onOpen({ id, documentType: FEATURE_TYPE, name })}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="truncate text-sm font-medium text-foreground">
          {name}
        </span>
        {status ? (
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold tracking-wide text-foreground">
            {status}
          </span>
        ) : null}
        {scope ? (
          <span className="text-[10px] tracking-wide text-muted-foreground">
            {scope}
          </span>
        ) : null}
      </button>
      {wbs ? (
        <button
          type="button"
          onClick={() =>
            onOpen({
              id: wbs.documentId,
              documentType: WBS_TYPE,
              name: wbs.name ?? "WBS",
            })
          }
          className="ml-3 shrink-0 text-xs font-medium text-vetra-primary hover:underline"
        >
          {wbs.name ?? "WBS"} →
        </button>
      ) : (
        <span className="ml-3 shrink-0 text-xs text-border">no WBS</span>
      )}
    </div>
  );
}
