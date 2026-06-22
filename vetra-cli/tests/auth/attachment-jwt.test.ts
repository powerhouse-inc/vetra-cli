import { describe, expect, it, jest } from "@jest/globals";

import { attachmentJwtHandler } from "../../src/auth/attachment-jwt.js";

describe("attachmentJwtHandler", () => {
  it("mints the renown token for the workdir + renownUrl and returns it", async () => {
    const mint = jest.fn(async () => "tok-abc");
    const handler = attachmentJwtHandler("/w", "https://renown.example", mint as never);
    await expect(handler("https://agent/attachments/reservations")).resolves.toBe("tok-abc");
    expect(mint).toHaveBeenCalledWith("/w", "https://renown.example");
  });

  it("maps null (agent not authorized) to undefined so the call is unauthenticated, not throwing", async () => {
    const handler = attachmentJwtHandler("/w", "r", (async () => null) as never);
    await expect(handler("u")).resolves.toBeUndefined();
  });
});
