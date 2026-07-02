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
      <h3 className="mb-3 text-base font-semibold text-foreground">
        Documents
      </h3>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-accent px-4 py-2 text-xs font-medium text-muted-foreground">
          Name
        </div>
        {!project || project.documents.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No documents in this project.
          </div>
        ) : (
          project.documents.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() =>
                onOpen({
                  id: doc.id,
                  documentType: doc.documentType,
                  name: doc.name,
                })
              }
              className="flex w-full items-center justify-between border-b border-border/40 px-4 py-3 text-left last:border-b-0 hover:bg-accent"
            >
              <span className="truncate text-sm font-medium text-foreground">
                {doc.name}
              </span>
              <span className="ml-3 shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {SPECIFY_TYPES.get(doc.documentType) ?? doc.documentType}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
