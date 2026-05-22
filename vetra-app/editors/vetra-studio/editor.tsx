import {
  useSelectedDrive,
  useSetPHAppConfig,
} from "@powerhousedao/reactor-browser";
import { editorConfig } from "./config.js";
import { VetraStudio } from "./VetraStudio.js";

export { VetraStudio } from "./VetraStudio.js";
export type { VetraStudioProps } from "./VetraStudio.js";

export default function Editor() {
  useSetPHAppConfig(editorConfig);
  const [document, dispatch] = useSelectedDrive();
  return <VetraStudio document={document} dispatch={dispatch} />;
}
