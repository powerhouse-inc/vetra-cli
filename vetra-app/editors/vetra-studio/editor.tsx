import {
  useSelectedDrive,
  useSetPHAppConfig,
} from "@powerhousedao/reactor-browser";
import { editorConfig } from "./config.js";
import { StudioShell } from "./shell/StudioShell.js";

export { VetraStudio } from "./VetraStudio.js";
export type { VetraStudioProps } from "./VetraStudio.js";

export default function Editor() {
  useSetPHAppConfig(editorConfig);
  const [document, dispatch] = useSelectedDrive();
  return <StudioShell document={document} dispatch={dispatch} />;
}
