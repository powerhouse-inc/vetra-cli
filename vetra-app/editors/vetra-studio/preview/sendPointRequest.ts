/**
 * A pointed request (P4-M3, Task 3.3): the customer's words plus the
 * `[Pointed at]` block, steered into the open change or the first message of
 * a new one. The screenshot is attached when it uploaded; a failed upload
 * never blocks the request.
 */
import type { UserContentPartInput } from "@powerhousedao/clint-common/document-models/chat-session";
import type { Change } from "document-models/studio-product";
import type { StartProductDrive } from "../idea/startProduct.js";
import { generateId } from "document-model";
import { startChange } from "../change/startChange.js";
import { driveAttachments } from "../hooks/useDriveAttachments.js";
import { sendSteer } from "../story/SteerBox.js";
import { pointContextText, type PointTarget } from "./pointTarget.js";

export const POINTED_FILE = "pointed.png";

export interface SendPointRequestArgs {
  /** What the customer typed under "Change this". */
  request: string;
  target: PointTarget;
  shot: Blob | null;
  drive: StartProductDrive;
  productId: string;
  /** The change a request joins; null starts one. */
  openChange: Change | null;
}

/** The screenshot as an IMAGE part; null when it cannot be uploaded. */
async function shotPart(
  drive: StartProductDrive,
  shot: Blob | null,
): Promise<UserContentPartInput | null> {
  if (!shot) return null;
  try {
    const service = driveAttachments(drive);
    const upload = await service.reserve({
      mimeType: "image/png",
      fileName: POINTED_FILE,
    });
    const { ref } = await upload.send(shot);
    return {
      id: generateId(),
      type: "IMAGE",
      filename: POINTED_FILE,
      mediaType: "image/png",
      attachment: ref,
    };
  } catch {
    // A screenshot that couldn't be uploaded is not worth failing the request.
    return null;
  }
}

/** The message a pointed request sends: the customer's words then the block. */
export function pointedText(request: string, target: PointTarget): string {
  return `${request.trim()}\n\n${pointContextText(target)}`;
}

/**
 * Send a pointed request: into the open change's conversation when there is
 * one, else as the first message of a new CHANGE.
 */
export async function sendPointRequest({
  request,
  target,
  shot,
  drive,
  productId,
  openChange,
}: SendPointRequestArgs): Promise<void> {
  const text = pointedText(request, target);
  const part = await shotPart(drive, shot);
  const parts = part ? [part] : [];
  if (openChange?.chatSessionId) {
    await sendSteer(openChange.chatSessionId, text, undefined, parts);
    return;
  }
  await startChange({
    drive,
    productId,
    request: text,
    kind: "CHANGE",
    contentParts: parts,
  });
}
