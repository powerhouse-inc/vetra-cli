import {
  useFileNodesInSelectedDrive,
  useFolderNodesInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import { useMemo } from "react";
import { deriveProjects, type Project } from "./projects.js";

/** Projects derived from the selected drive's nodes, memoized per snapshot.
 * Returns [] while the drive is still hydrating. */
export function useProjects(): Project[] {
  const files = useFileNodesInSelectedDrive();
  const folders = useFolderNodesInSelectedDrive();
  return useMemo(
    () => deriveProjects(files ?? [], folders ?? []),
    [files, folders],
  );
}
