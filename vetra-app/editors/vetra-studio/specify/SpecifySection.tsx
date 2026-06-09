import {
  useFileNodesInSelectedDrive,
  useFolderNodesInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import { useState } from "react";
import { Breadcrumb, type Crumb } from "../Breadcrumb.js";
import type { OpenTarget } from "../ideation/types.js";
import { DocumentModelHost } from "./DocumentModelHost.js";
import { ProjectList } from "./ProjectList.js";
import { ProjectModels } from "./ProjectModels.js";
import { UNGROUPED_PROJECT_ID, UNGROUPED_PROJECT_NAME } from "./projects.js";

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
  const files = useFileNodesInSelectedDrive();
  const folders = useFolderNodesInSelectedDrive();

  // The project the open model belongs to — used when auto-follow opened a
  // model directly without the user drilling through a project first.
  const openParent = open
    ? files?.find((f) => f.id === open.id)?.parentFolder
    : undefined;
  const openProjectId = open ? (openParent ?? UNGROUPED_PROJECT_ID) : undefined;
  const projectForCrumb = open ? openProjectId : projectId;
  const projectName =
    projectForCrumb === UNGROUPED_PROJECT_ID
      ? UNGROUPED_PROJECT_NAME
      : folders?.find((f) => f.id === projectForCrumb)?.name;

  const handleBackToProjects = () => {
    onClear();
    setProjectId(null);
  };
  const handleBackToModels = () => {
    if (openProjectId) setProjectId(openProjectId);
    onClear();
  };

  const crumbs: Crumb[] = [
    { label: productName, onClick: onExitToHome },
    {
      label: "Specify",
      onClick: open || projectId ? handleBackToProjects : undefined,
    },
    ...(projectForCrumb && projectName
      ? [{ label: projectName, onClick: open ? handleBackToModels : undefined }]
      : []),
    ...(open ? [{ label: open.name }] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <Breadcrumb items={crumbs} />
      {open ? (
        <DocumentModelHost id={open.id} />
      ) : projectId ? (
        <ProjectModels projectId={projectId} onOpen={onOpen} />
      ) : (
        <ProjectList onSelectProject={setProjectId} />
      )}
    </div>
  );
}
