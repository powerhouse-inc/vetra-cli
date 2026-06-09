import type { OpenTarget } from "../ideation/types.js";
import { DOCUMENT_MODEL_TYPE } from "./projects.js";
import { useProjects } from "./useProjects.js";

/** Home > Specify > <project>: the project's document-model files. */
export function ProjectModels({
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
      <h3 className="mb-3 text-base font-semibold text-gray-800">
        Document models
      </h3>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500">
          Model name
        </div>
        {!project || project.models.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400">
            No document models in this project.
          </div>
        ) : (
          project.models.map((model) => (
            <button
              key={model.id}
              type="button"
              onClick={() =>
                onOpen({
                  id: model.id,
                  documentType: DOCUMENT_MODEL_TYPE,
                  name: model.name,
                })
              }
              className="block w-full border-b border-gray-100 px-4 py-3 text-left last:border-b-0 hover:bg-gray-50"
            >
              <span className="truncate text-sm font-medium text-gray-800">
                {model.name}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
