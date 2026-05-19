import { reactorProjectBuild } from "./build.js";
import { reactorProjectInit } from "./init.js";
import { reactorProjectPublish } from "./publish.js";

export const reactorProjectCommands = [
  reactorProjectInit,
  reactorProjectBuild,
  reactorProjectPublish,
];
