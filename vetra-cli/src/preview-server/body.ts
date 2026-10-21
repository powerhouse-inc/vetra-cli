/** Reading a raw request body with a hard size limit. */
import type { IncomingMessage } from "node:http";

/** Largest material upload the Studio takes. */
export const MATERIAL_MAX_BYTES = 15 * 1024 * 1024;

export class BodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`request body over ${limitBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/**
 * The whole body as one Buffer. Past `limitBytes` (by Content-Length or by
 * what actually arrives) it rejects with `BodyTooLargeError` at once and
 * drains the rest unbuffered, so the caller can still answer.
 */
export function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limitBytes) {
      req.resume();
      reject(new BodyTooLargeError(limitBytes));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        done = true;
        chunks.length = 0;
        req.off("data", onData);
        req.resume();
        reject(new BodyTooLargeError(limitBytes));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.once("end", () => {
      if (!done) resolve(Buffer.concat(chunks, size));
    });
    req.once("error", (err) => {
      if (!done) reject(err);
      done = true;
    });
  });
}
