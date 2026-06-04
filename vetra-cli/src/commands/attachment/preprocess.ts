import { z } from "zod";
import path from "node:path";
import { createAttachmentClient } from "@powerhousedao/reactor-attachments/client";
import { defineCommand } from "../../framework.js";
import {
  attachmentsUnavailableMessage,
  fileToBlob,
  getAttachmentService,
  inferMimeType,
} from "../../helpers/attachment.js";

export const attachmentPreprocess = defineCommand({
  id: "attachment-preprocess",
  description:
    "Compute an attachment's content-addressed ref (attachment://v1:<sha256>) from a local file WITHOUT uploading. Embed the returned ref in a document action now, then send the bytes with attachment-upload for the same file after / in parallel with submitting the action.",
  inputSchema: z.object({
    filePath: z
      .string()
      .describe("Path to the local file to reference (absolute, or relative to the workdir)."),
    mimeType: z
      .string()
      .optional()
      .describe("MIME type; inferred from the file extension when omitted."),
    fileName: z
      .string()
      .optional()
      .describe("Stored file name; defaults to the file's basename."),
  }),
  execute: async (input, context) => {
    const service = await getAttachmentService(context);
    if (!service) return { text: attachmentsUnavailableMessage() };

    const filePath = path.resolve(context.workdir, input.filePath);
    const mimeType = inferMimeType(filePath, input.mimeType);
    const fileName = input.fileName ?? path.basename(filePath);
    const blob = await fileToBlob(filePath, mimeType);

    const pre = await createAttachmentClient(service).preprocess(blob, {
      fileName,
      mimeType,
    });

    return {
      text:
        `ref: ${pre.ref}\n` +
        `hash: ${pre.hash}\n` +
        `sizeBytes: ${pre.sizeBytes}\n` +
        `mimeType: ${mimeType}\n` +
        `fileName: ${fileName}\n` +
        `Not uploaded yet — embed this ref in the action, then run attachment-upload on the same file to send the bytes.`,
    };
  },
});
