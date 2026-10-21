import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestUnderstanding,
  uploadMaterial,
  WorkshopClientError,
} from "./workshop-client.js";

vi.mock("./preview-server-client.js", () => ({
  resolvePreviewConfig: () =>
    Promise.resolve({ base: "https://studio.test/preview", loaded: true }),
  ownerHeaders: () => Promise.resolve({ Authorization: "Bearer t" }),
}));

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function reply(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof WorkshopClientError) return err.code;
  }
  return "none";
}

describe("workshop client", () => {
  it("uploads the raw bytes with the owner header", async () => {
    const card = { id: "m1", name: "a.csv", kind: "SHEET" };
    reply(201, card);
    const file = new File(["a,b"], "a b.csv", { type: "text/csv" });
    expect(await uploadMaterial(file)).toEqual(card);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://studio.test/preview/workshop/material?name=a+b.csv&type=text%2Fcsv",
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBe(file);
    expect(init.headers).toMatchObject({ Authorization: "Bearer t" });
  });

  it("maps 413/415/422/402/401 to codes", async () => {
    const file = new File(["x"], "a.txt");
    const input = { materialIds: [], text: "x", language: "en" as const };
    reply(413);
    expect(await codeOf(uploadMaterial(file))).toBe("too-large");
    reply(415);
    expect(await codeOf(uploadMaterial(file))).toBe("unsupported");
    reply(422, { error: "unreadable", notes: [] });
    expect(await codeOf(requestUnderstanding(input))).toBe("unreadable");
    reply(402);
    expect(await codeOf(requestUnderstanding(input))).toBe("budget");
    reply(401);
    expect(await codeOf(uploadMaterial(file))).toBe("owner");
    reply(500);
    expect(await codeOf(uploadMaterial(file))).toBe("network");
    fetchMock.mockRejectedValueOnce(new TypeError("down"));
    expect(await codeOf(uploadMaterial(file))).toBe("network");
  });

  it("posts the understanding request as JSON", async () => {
    const result = { draft: { version: 1 }, notes: [], costUsd: 0, ms: 5 };
    reply(200, result);
    const input = { materialIds: ["m1"], text: "hi", language: "de" as const };
    expect(await requestUnderstanding(input)).toEqual(result);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});
