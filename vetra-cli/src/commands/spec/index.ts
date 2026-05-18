import { specCreate } from "./create.js";
import { specDelete } from "./delete.js";
import { specExtract } from "./extract.js";
import { specGet } from "./get.js";
import { specList } from "./list.js";
import { specSchema } from "./schema.js";
import { specSchemaList } from "./schema-list.js";
import { specUpdate } from "./update.js";

export const specCommands = [
  specList,
  specGet,
  specCreate,
  specUpdate,
  specDelete,
  specExtract,
  specSchemaList,
  specSchema,
];
