import { specPreviewCreate } from "./create.js";
import { specPreviewDelete } from "./delete.js";
import { specPreviewGet } from "./get.js";
import { specPreviewList } from "./list.js";
import { specPreviewShow } from "./show.js";
import { specPreviewUpdate } from "./update.js";

export const specPreviewCommands = [
  specPreviewList,
  specPreviewGet,
  specPreviewCreate,
  specPreviewUpdate,
  specPreviewDelete,
  specPreviewShow,
];
