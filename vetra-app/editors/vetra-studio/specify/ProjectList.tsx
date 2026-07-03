import { useProjects } from "./useProjects.js";

/** Home > Specify: the projects (drive folders) holding spec documents. */
export function ProjectList({
  onSelectProject,
}: {
  onSelectProject: (projectId: string) => void;
}) {
  const projects = useProjects();

  return (
    <section>
      <h3 className="mb-3 text-base font-semibold text-foreground">Projects</h3>
      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-accent px-4 py-6 text-sm text-muted-foreground">
          No specification documents yet. Ask the agent to specify one.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onSelectProject(project.id)}
              className="flex h-28 flex-col justify-between rounded-lg border border-border bg-card p-4 text-left hover:border-muted-foreground hover:shadow-sm"
            >
              <span className="truncate text-sm font-semibold text-foreground">
                {project.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {project.documents.length}{" "}
                {project.documents.length === 1 ? "document" : "documents"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
