import type { OpenTarget } from "../ideation/types.js";
import { SPECIFY_TYPES } from "./projects.js";
import { useProjects } from "./useProjects.js";

/** Home > Specify > <project>: the project's spec documents. */
export function ProjectDocuments({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (target: OpenTarget) => void;
}) {
  const projects = useProjects();
  const project = projects.find((p) => p.id === projectId);

  return (
    <section>
      <h3 className="mb-3 text-base font-semibold text-vetra-fg">Documents</h3>
      <div className="overflow-hidden rounded-lg border border-vetra-border bg-vetra-card">
        <div className="border-b border-vetra-border bg-vetra-accent px-4 py-2 text-xs font-medium text-vetra-muted-fg">
          Name
        </div>
        {!project || project.documents.length === 0 ? (
          <div className="px-4 py-6 text-sm text-vetra-muted-fg">
            No documents in this project.
          </div>
        ) : (
          project.documents.map((doc) => (
            <button
              key={doc.id}
              type="button"
              data-tour={`model-${doc.documentType.split("/")[1] ?? doc.documentType}`}
              onClick={() =>
                onOpen({
                  id: doc.id,
                  documentType: doc.documentType,
                  name: doc.name,
                })
              }
              className="flex w-full items-center justify-between border-b border-vetra-border/40 px-4 py-3 text-left last:border-b-0 hover:bg-vetra-accent"
            >
              <span className="truncate text-sm font-medium text-vetra-fg">
                {doc.name}
              </span>
              <span className="ml-3 shrink-0 rounded bg-vetra-muted px-2 py-0.5 text-xs text-vetra-muted-fg">
                {SPECIFY_TYPES.get(doc.documentType) ?? doc.documentType}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
