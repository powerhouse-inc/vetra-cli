import { z } from "zod";
import path from "node:path";
import {
  createAttachmentClient,
  type AttachmentUploadResult,
} from "@powerhousedao/reactor-attachments/client";
import { defineCommand } from "../../framework.js";
import {
  attachmentsUnavailableMessage,
  fileToBlob,
  getAttachmentService,
  inferMimeType,
  isAttachmentAlreadyExists,
} from "../../helpers/attachment.js";

export const attachmentUpload = defineCommand({
  id: "attachment-upload",
  description:
    "Upload a local file to the attachment store and return its content-addressed ref (attachment://v1:<sha256>). The ref is deterministic from the bytes and identical content dedups. Embed the ref in a document action; the action may be submitted before or after this upload.",
  inputSchema: z.object({
    filePath: z
      .string()
      .describe("Path to the local file to upload (absolute, or relative to the workdir)."),
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

    const client = createAttachmentClient(service);
    const pre = await client.preprocess(blob, { fileName, mimeType });

    let result: AttachmentUploadResult;
    try {
      result = await client.reserve(pre.options, (handle) => handle.send(pre.stream()));
    } catch (err) {
      // Dedup: client.reserve's instanceof catch can miss this across entry bundles, so recover via the deterministic ref.
      if (!isAttachmentAlreadyExists(err)) throw err;
      const header = await service.stat(pre.ref);
      result = { ref: pre.ref, hash: pre.hash, header };
    }

    return {
      text:
        `ref: ${result.ref}\n` +
        `hash: ${result.hash}\n` +
        `status: ${result.header.status}\n` +
        `sizeBytes: ${result.header.sizeBytes}\n` +
        `mimeType: ${result.header.mimeType}\n` +
        `fileName: ${result.header.fileName}`,
    };
  },
});
