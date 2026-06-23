import { reactorProjectBuild } from "./build.js";
import { reactorProjectCheck } from "./check.js";
import { reactorProjectInit } from "./init.js";
import { reactorProjectPublish } from "./publish.js";
import { reactorProjectPublishStatus } from "./publish-status.js";
import { reactorProjectStart } from "./start.js";

export const reactorProjectCommands = [
  reactorProjectInit,
  reactorProjectBuild,
  reactorProjectCheck,
  reactorProjectPublish,
  reactorProjectPublishStatus,
  reactorProjectStart,
];
