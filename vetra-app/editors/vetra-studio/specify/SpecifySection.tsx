import { useState } from "react";
import { Breadcrumb, type Crumb } from "../Breadcrumb.js";
import type { OpenTarget } from "../ideation/types.js";
import { SpecDocumentHost } from "./SpecDocumentHost.js";
import { ProjectList } from "./ProjectList.js";
import { ProjectModels } from "./ProjectModels.js";
import { useProjects } from "./useProjects.js";

/**
 * Home > Specify. Browses projects (drive folders holding document-models),
 * a project's models, and opens a model in the document-model editor inline.
 *
 * The open document is **controlled** by `VetraStudio` (lifted so auto-nav
 * can drive it); which project is browsed is local sub-navigation state.
 */
export function SpecifySection({
  productName,
  open,
  onOpen,
  onClear,
  onExitToHome,
}: {
  productName: string;
  open: OpenTarget | null;
  onOpen: (target: OpenTarget) => void;
  onClear: () => void;
  onExitToHome: () => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const projects = useProjects();

  // The project of the open model, resolved from the derived projects. While
  // the drive is hydrating (or the model's file node hasn't synced yet) this
  // is undefined and the project crumb is omitted — never mislabeled.
  const openProject = open
    ? projects.find((p) => p.documents.some((doc) => doc.id === open.id))
    : undefined;
  const project = open ? openProject : projects.find((p) => p.id === projectId);

  const handleBackToProjects = () => {
    onClear();
    setProjectId(null);
  };
  const handleBackToModels = () => {
    if (openProject) setProjectId(openProject.id);
    onClear();
  };

  const crumbs: Crumb[] = [
    { label: productName, onClick: onExitToHome },
    {
      label: "Specify",
      onClick: open || projectId ? handleBackToProjects : undefined,
    },
    ...(project
      ? [
          {
            label: project.name,
            onClick: open ? handleBackToModels : undefined,
          },
        ]
      : []),
    ...(open ? [{ label: open.name }] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <Breadcrumb items={crumbs} />
      {open ? (
        <SpecDocumentHost
          id={open.id}
          documentType={open.documentType}
          onClose={onClear}
        />
      ) : projectId ? (
        <ProjectModels projectId={projectId} onOpen={onOpen} />
      ) : (
        <ProjectList onSelectProject={setProjectId} />
      )}
    </div>
  );
}
