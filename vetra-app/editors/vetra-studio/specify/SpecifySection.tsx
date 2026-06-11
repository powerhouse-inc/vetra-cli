import { useState } from "react";
import { Breadcrumb, type Crumb } from "../Breadcrumb.js";
import type { OpenTarget } from "../ideation/types.js";
import { SpecDocumentHost } from "./SpecDocumentHost.js";
import { ProjectList } from "./ProjectList.js";
import { ProjectDocuments } from "./ProjectDocuments.js";
import { useProjects } from "./useProjects.js";

/**
 * Home > Specify. Browses projects (drive folders holding spec documents),
 * a project's documents, and opens one in the appropriate editor inline.
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

  // The project of the open document, resolved from the derived projects. While
  // the drive is hydrating (or the document's file node hasn't synced yet) this
  // is undefined and the project crumb is omitted — never mislabeled.
  const openProject = open
    ? projects.find((p) => p.documents.some((doc) => doc.id === open.id))
    : undefined;
  const project = open ? openProject : projects.find((p) => p.id === projectId);

  const handleBackToProjects = () => {
    onClear();
    setProjectId(null);
  };
  const handleBackToDocuments = () => {
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
            onClick: open ? handleBackToDocuments : undefined,
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
        <ProjectDocuments projectId={projectId} onOpen={onOpen} />
      ) : (
        <ProjectList onSelectProject={setProjectId} />
      )}
    </div>
  );
}
