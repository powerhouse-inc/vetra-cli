import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "@jest/globals";

import { BodyTooLargeError, readBody } from "../../src/preview-server/body.js";

function request(chunks: Buffer[], headers: Record<string, string> = {}): IncomingMessage {
  return Object.assign(Readable.from(chunks), { headers }) as unknown as IncomingMessage;
}

describe("readBody", () => {
  it("returns the whole body", async () => {
    const body = await readBody(request([Buffer.from("ab"), Buffer.from("cd")]), 10);
    expect(body.toString()).toBe("abcd");
  });

  it("rejects a streamed body past the limit", async () => {
    const chunks = [Buffer.alloc(6), Buffer.alloc(6)];
    await expect(readBody(request(chunks), 10)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("rejects a declared length past the limit before reading", async () => {
    await expect(
      readBody(request([Buffer.alloc(1)], { "content-length": "11" }), 10),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
