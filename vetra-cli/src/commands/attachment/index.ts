import { attachmentPreprocess } from "./preprocess.js";
import { attachmentUpload } from "./upload.js";
import { attachmentStat } from "./stat.js";
import { attachmentGet } from "./get.js";

export const attachmentCommands = [
  attachmentPreprocess,
  attachmentUpload,
  attachmentStat,
  attachmentGet,
];
