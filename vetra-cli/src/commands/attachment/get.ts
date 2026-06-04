import { z } from "zod";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { defineCommand } from "../../framework.js";
import {
  asRef,
  attachmentsUnavailableMessage,
  getAttachmentService,
} from "../../helpers/attachment.js";

export const attachmentGet = defineCommand({
  id: "attachment-get",
  description:
    "Download an attachment's bytes by ref (attachment://v1:<sha256>) to a local file. Errors if the attachment is still pending (bytes not yet uploaded).",
  inputSchema: z.object({
    ref: z.string().describe("Attachment ref, e.g. attachment://v1:<sha256hex>."),
    outPath: z
      .string()
      .describe("Path to write the bytes to (absolute, or relative to the workdir)."),
  }),
  execute: async (input, context) => {
    const service = await getAttachmentService(context);
    if (!service) return { text: attachmentsUnavailableMessage() };

    const outPath = path.resolve(context.workdir, input.outPath);
    try {
      const res = await service.get(asRef(input.ref));
      const body = res.body as unknown as NodeWebReadableStream<Uint8Array>;
      await pipeline(Readable.fromWeb(body), createWriteStream(outPath));
      return {
        text:
          `Wrote ${res.header.sizeBytes} bytes to ${outPath}\n` +
          `ref: ${input.ref}\n` +
          `mimeType: ${res.header.mimeType}\n` +
          `fileName: ${res.header.fileName}`,
      };
    } catch (err) {
      return { text: `Could not get ${input.ref}: ${(err as Error).message}` };
    }
  },
});
