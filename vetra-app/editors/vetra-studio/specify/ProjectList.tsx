import {
  useFileNodesInSelectedDrive,
  useFolderNodesInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import { deriveProjects } from "./projects.js";

/** Home > Specify: the projects (drive folders) holding document-models. */
export function ProjectList({
  onSelectProject,
}: {
  onSelectProject: (projectId: string) => void;
}) {
  const files = useFileNodesInSelectedDrive();
  const folders = useFolderNodesInSelectedDrive();
  const projects = deriveProjects(files ?? [], folders ?? []);

  return (
    <section>
      <h3 className="mb-3 text-base font-semibold text-gray-800">Projects</h3>
      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-400">
          No document models yet. Ask the agent to specify one.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onSelectProject(project.id)}
              className="flex h-28 flex-col justify-between rounded-lg border border-gray-300 bg-white p-4 text-left hover:border-gray-400 hover:shadow-sm"
            >
              <span className="truncate text-sm font-semibold text-gray-800">
                {project.name}
              </span>
              <span className="text-xs text-gray-500">
                {project.models.length}{" "}
                {project.models.length === 1 ? "model" : "models"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
