/**
 * The client's one iterate call (P4-M3, Task 3.5): a text edit at
 * `POST /iterate/text`, with the owner bearer like the other owner-only
 * preview-server routes (`fetchProjectPackage` is the pattern).
 */
import { ownerHeaders, resolvePreviewConfig } from "./preview-server-client.js";

export type TextEditResult = {
  applied: boolean;
  changeId?: string;
  /** How many places the old text was found; only meaningful when not applied. */
  matches?: number;
};

/** Ask the Studio to change the one place that shows `oldText` to `newText`. */
export async function editText(
  oldText: string,
  newText: string,
): Promise<TextEditResult> {
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/iterate/text`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(await ownerHeaders()),
    },
    body: JSON.stringify({ oldText, newText }),
  });
  if (!res.ok) {
    throw new Error(
      `preview-server /iterate/text: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as TextEditResult;
}
