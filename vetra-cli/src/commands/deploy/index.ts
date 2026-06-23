import { deployEnvironmentCreate } from "./create.js";
import { deployEnvironmentGet } from "./get.js";
import { deployEnvironmentList } from "./list.js";
import { deployEnvironmentUpdate } from "./update.js";
import { deployEnvironmentWait } from "./wait.js";

export const deployCommands = [
  deployEnvironmentList,
  deployEnvironmentGet,
  deployEnvironmentCreate,
  deployEnvironmentUpdate,
  deployEnvironmentWait,
];
