import { z } from "zod";
import { defineCommand } from "../../framework.js";
import {
  asRef,
  attachmentsUnavailableMessage,
  getAttachmentService,
} from "../../helpers/attachment.js";

export const attachmentStat = defineCommand({
  id: "attachment-stat",
  description:
    "Look up an attachment by ref (attachment://v1:<sha256>) and report its status + metadata. status='pending' = reserved but not yet uploaded; 'available' = stored; 'evicted' = metadata known, bytes reclaimed.",
  inputSchema: z.object({
    ref: z.string().describe("Attachment ref, e.g. attachment://v1:<sha256hex>."),
  }),
  execute: async (input, context) => {
    const service = await getAttachmentService(context);
    if (!service) return { text: attachmentsUnavailableMessage() };

    try {
      const h = await service.stat(asRef(input.ref));
      return {
        text:
          `ref: ${input.ref}\n` +
          `status: ${h.status}\n` +
          `mimeType: ${h.mimeType}\n` +
          `fileName: ${h.fileName}\n` +
          `sizeBytes: ${h.sizeBytes}\n` +
          `createdAtUtc: ${h.createdAtUtc}` +
          (h.expiresAtUtc ? `\nexpiresAtUtc: ${h.expiresAtUtc}` : ""),
      };
    } catch (err) {
      return { text: `Not found or error for ${input.ref}: ${(err as Error).message}` };
    }
  },
});
