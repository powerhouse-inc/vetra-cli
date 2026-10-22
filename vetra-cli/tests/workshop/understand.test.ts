import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { APICallError } from "ai";

import { createRequestAuthorizer } from "../../src/preview-server/request-auth.js";
import { startPreviewServer } from "../../src/preview-server/server.js";
import { loadMaterial, saveMaterial, type MaterialInfo } from "../../src/workshop/material.js";
import {
  clampDraft,
  understand,
  UnderstandUnreadableError,
  UNDERSTAND_MAX_OUTPUT_TOKENS,
  UNDERSTAND_RETRY_MAX_OUTPUT_TOKENS,
  type UnderstandDeps,
  type UnderstandRequest,
} from "../../src/workshop/understand.js";
import { DRAFT_FIELD_TYPES } from "vetra-app/shared/understood-draft";
import { makeWorkdir } from "../spec/_fixtures.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "workshop");

function reply(draft: Record<string, unknown>, cost?: number) {
  return {
    text: JSON.stringify(draft),
    ...(cost !== undefined && { providerMetadata: { openrouter: { usage: { cost } } } }),
  };
}

function thing(name: string, fields: Record<string, unknown>[] = [{ id: "f1", name: "Name", type: "text" }]) {
  return { summary: `About ${name}`, things: [{ id: "t1", name, fields }] };
}

let seq = 0;
const ids = () => `id-${++seq}`;

/** Fake model: answers each call by what its message holds. */
function fakeDeps(answer: (req: UnderstandRequest) => Promise<{ text: string; providerMetadata?: unknown }>) {
  const calls: UnderstandRequest[] = [];
  const deps: UnderstandDeps = {
    ids,
    generate: (req) => {
      calls.push(req);
      return answer(req);
    },
  };
  return { deps, calls };
}

function messageText(req: UnderstandRequest): string {
  const content = req.messages[0].content;
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("\n");
}

describe("understand", () => {
  let workdir: string;
  let cleanup: () => void;
  let sheet: MaterialInfo;
  let photo: MaterialInfo;

  beforeEach(async () => {
    ({ workdir, cleanup } = makeWorkdir());
    sheet = await saveMaterial(workdir, {
      fileName: "maengel.csv",
      mimeType: "text/csv",
      bytes: Buffer.from("Raum;Mangel;Erledigt\nKüche;Riss;ja\nBad;Fliese;nein\n"),
    });
    photo = await saveMaterial(workdir, {
      fileName: "form.png",
      mimeType: "image/png",
      bytes: readFileSync(join(FIXTURES, "photo.png")),
    });
  });
  afterEach(() => cleanup());

  it("a sheet's columns become fields with their source column", async () => {
    const tab = sheet.sheets![0].sheet;
    const { deps, calls } = fakeDeps(async () =>
      reply(
        thing("Mangel", [
          { id: "f1", name: "Raum", type: "text", source: { materialId: "made-up", sheet: tab, column: "Raum" } },
          { id: "f2", name: "Erledigt", type: "yes-no", source: { materialId: sheet.id, sheet: tab, column: "Erledigt" } },
          { id: "f3", name: "Foto", type: "photo", source: { materialId: sheet.id, sheet: tab, column: "Nope" } },
        ]),
      ),
    );
    const result = await understand(deps, { materials: [sheet], text: "", language: "de" });

    expect(messageText(calls[0])).toContain("Raum\tMangel\tErledigt");
    expect(messageText(calls[0])).toContain("Küche\tRiss\tja");
    expect(messageText(calls[0])).toContain("2 rows");
    const fields = result.draft.things[0].fields;
    expect(fields.map((f) => f.source)).toEqual([
      { materialId: sheet.id, sheet: tab, column: "Raum" },
      { materialId: sheet.id, sheet: tab, column: "Erledigt" },
      { materialId: sheet.id, sheet: tab, column: null },
    ]);
    expect(result.draft.materials).toEqual([{ id: sheet.id, name: "maengel.csv", kind: "SHEET" }]);
  });

  it("a picture is sent as a file part", async () => {
    const { deps, calls } = fakeDeps(async () => reply(thing("Formular")));
    await understand(deps, { materials: [photo], text: "", language: "en" });

    expect(calls).toHaveLength(1);
    expect(calls[0].maxOutputTokens).toBe(UNDERSTAND_MAX_OUTPUT_TOKENS);
    expect(calls[0].abortSignal).toBeInstanceOf(AbortSignal);
    const content = calls[0].messages[0].content as Array<Record<string, unknown>>;
    const file = content.find((p) => p.type === "file");
    expect(file?.mediaType).toBe("image/png");
    expect(Buffer.from(file?.data as Uint8Array).equals(readFileSync(join(FIXTURES, "photo.png")))).toBe(true);
    expect(messageText(calls[0])).toContain(photo.id);
  });

  it("a PDF is sent as a file part", async () => {
    const pdf = await saveMaterial(workdir, {
      fileName: "page.pdf",
      mimeType: "application/pdf",
      bytes: readFileSync(join(FIXTURES, "one-page.pdf")),
    });
    const { deps, calls } = fakeDeps(async () => reply(thing("Seite")));
    await understand(deps, { materials: [pdf], text: "", language: "en" });
    const content = calls[0].messages[0].content as Array<Record<string, unknown>>;
    expect(content.find((p) => p.type === "file")?.mediaType).toBe("application/pdf");
  });

  it("inputs are read in parallel", async () => {
    const { deps, calls } = fakeDeps(
      () => new Promise((resolve) => setTimeout(() => resolve(reply(thing("Ding"))), 1000)),
    );
    const t0 = Date.now();
    await understand(deps, { materials: [photo], text: "A list of defects per room.", language: "en" });
    expect(calls).toHaveLength(2);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("one failed input still returns the others with a per-file note", async () => {
    const { deps } = fakeDeps(async (req) => {
      if (messageText(req).includes(photo.id)) throw new Error("provider down");
      return reply(thing("Mangel"));
    });
    const result = await understand(deps, { materials: [photo, sheet], text: "", language: "en" });
    expect(result.draft.things.map((t) => t.name)).toEqual(["Mangel"]);
    expect(result.notes).toEqual([
      { materialId: photo.id, text: "Couldn't read form.png. Describe it in a sentence instead." },
    ]);
    // Every material stays listed, read or not.
    expect(result.draft.materials.map((m) => m.id)).toEqual([photo.id, sheet.id]);
  });

  it("an unparseable reply counts as a failed input", async () => {
    const { deps } = fakeDeps(async (req) =>
      messageText(req).includes(photo.id) ? { text: "I cannot see anything." } : reply(thing("Mangel")),
    );
    const result = await understand(deps, { materials: [photo, sheet], text: "", language: "de" });
    expect(result.notes).toEqual([
      { materialId: photo.id, text: "form.png konnte ich nicht lesen. Beschreib es stattdessen in einem Satz." },
    ]);
  });

  it("all inputs failing is unreadable", async () => {
    const { deps } = fakeDeps(async () => {
      throw new Error("nope");
    });
    const err = await understand(deps, { materials: [photo], text: "Prüfliste", language: "de" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnderstandUnreadableError);
    expect((err as UnderstandUnreadableError).notes).toEqual([
      { materialId: photo.id, text: "form.png konnte ich nicht lesen. Beschreib es stattdessen in einem Satz." },
      { materialId: null, text: "Deinen Text konnte ich nicht lesen. Beschreib es stattdessen in einem Satz." },
    ]);
  });

  it("draft names come back in the requested language", async () => {
    const { deps, calls } = fakeDeps(async () => reply({ ...thing("Prüfung"), language: "en" }));
    const result = await understand(deps, { materials: [], text: "Wir prüfen Räume.", language: "de" });
    expect(calls[0].system).toContain("Write every name, the summary and the questions in German.");
    expect(calls[0].system).toContain(`Field types (only these): ${DRAFT_FIELD_TYPES.join(", ")}`);
    expect(messageText(calls[0])).toContain("Wir prüfen Räume.");
    expect(result.draft.language).toBe("de");
    // The typed description has no material to point at.
    expect(result.draft.things[0].fields[0].source).toBeNull();

    const en = fakeDeps(async () => reply(thing("Inspection")));
    await understand(en.deps, { materials: [], text: "We inspect rooms.", language: "en" });
    expect(en.calls[0].system).toContain("in English.");
  });

  it("an unparseable reply is retried once", async () => {
    let calls = 0;
    const { deps } = fakeDeps(async () => {
      calls++;
      return calls === 1 ? { text: "not json" } : reply(thing("Mangel"));
    });
    const result = await understand(deps, { materials: [], text: "Prüfliste", language: "de" });
    expect(calls).toBe(2);
    expect(result.notes).toEqual([]);
    expect(result.draft.things.map((t) => t.name)).toEqual(["Mangel"]);
  });

  // The P5 material rerun: deepseek-v4.1-flash spent all 4096 output tokens on
  // reasoning, returned empty content (finish_reason "length"), and the retry
  // repeated the same cap — so the xlsx stayed "unread" over 4 attempts.
  it("a reply cut off at the output cap is retried with a bigger budget", async () => {
    let calls = 0;
    const { deps, calls: requests } = fakeDeps(async () => {
      calls++;
      return calls === 1
        ? { text: "", finishReason: "length" }
        : reply(thing("Mangel"));
    });
    const result = await understand(deps, {
      materials: [],
      text: "Prüfliste",
      language: "de",
    });
    expect(calls).toBe(2);
    expect(requests[0].maxOutputTokens).toBe(UNDERSTAND_MAX_OUTPUT_TOKENS);
    expect(requests[1].maxOutputTokens).toBe(UNDERSTAND_RETRY_MAX_OUTPUT_TOKENS);
    expect(requests[1].maxOutputTokens).toBeGreaterThan(requests[0].maxOutputTokens);
    expect(result.notes).toEqual([]);
  });

  it("a retry re-reads the input from disk instead of resending the first read", async () => {
    const note = await saveMaterial(workdir, {
      fileName: "notiz.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("erste Fassung"),
    });
    const seen: string[] = [];
    let calls = 0;
    const { deps } = fakeDeps(async (req) => {
      seen.push(messageText(req));
      calls++;
      if (calls === 1) {
        writeFileSync(note.path, "zweite Fassung");
        return { text: "", finishReason: "length" };
      }
      return reply(thing("Notiz"));
    });

    const result = await understand(deps, {
      materials: [note],
      text: "",
      language: "de",
    });

    expect(calls).toBe(2);
    expect(seen[0]).toContain("erste Fassung");
    expect(seen[1]).toContain("zweite Fassung");
    expect(result.notes).toEqual([]);
  });

  it("a diagram with steps but no things is still a read", async () => {
    const { deps } = fakeDeps(async () => ({
      text: JSON.stringify({
        roles: [{ id: "r1", name: "Bauleitung" }],
        steps: [{ id: "s1", name: "Prüfen", roleId: "r1", thingId: null }],
      }),
    }));
    const result = await understand(deps, { materials: [photo], text: "", language: "de" });
    expect(result.notes).toEqual([]);
    expect(result.draft.things).toEqual([]);
    expect(result.draft.steps.map((s) => s.name)).toEqual(["Prüfen"]);
  });

  it("fenced JSON is accepted", async () => {
    const { deps } = fakeDeps(async () => ({
      text: "Here you go:\n```json\n" + JSON.stringify(thing("Übergabe")) + "\n```",
    }));
    const result = await understand(deps, { materials: [], text: "Übergabeprotokoll", language: "de" });
    expect(result.draft.things[0].name).toBe("Übergabe");
    expect(result.notes).toEqual([]);
  });

  it("cost is the sum of the calls", async () => {
    const { deps } = fakeDeps(async (req) =>
      messageText(req).includes(photo.id) ? reply(thing("A"), 0.0012) : reply(thing("B"), 0.0003),
    );
    const result = await understand(deps, { materials: [photo, sheet], text: "x", language: "en" });
    expect(result.costUsd).toBeCloseTo(0.0012 + 0.0003 * 2, 10);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it("merges drafts across inputs without id clashes", async () => {
    const { deps } = fakeDeps(async (req) =>
      messageText(req).includes(photo.id)
        ? reply({
            ...thing("Mangel", [{ id: "f1", name: "Foto", type: "photo" }]),
            roles: [{ id: "r1", name: "Bauleiter" }],
            steps: [{ id: "s1", name: "Erfassen", roleId: "r1", thingId: "t1" }],
          })
        : reply(thing("Raum")),
    );
    const result = await understand(deps, { materials: [photo, sheet], text: "", language: "de" });
    const [mangel, raum] = result.draft.things;
    expect(mangel.id).not.toBe(raum.id);
    expect(result.draft.steps[0]).toMatchObject({ roleId: result.draft.roles[0].id, thingId: mangel.id });
  });

  it("the merged draft respects the limits", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`,
      name: `T${i}`,
      fields: Array.from({ length: 20 }, (_, j) => ({ id: `f${j}`, name: `F${j}`, type: "text" as const, options: [], source: null })),
    }));
    const clamped = clampDraft({
      version: 1,
      language: "en",
      summary: "",
      things: many,
      roles: [],
      steps: Array.from({ length: 15 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, roleId: "gone", thingId: "t11" })),
      links: [{ from: "t0", to: "t11", label: "" }],
      questions: ["a", "b", "c", "d"],
      materials: [],
    });
    expect(clamped.things).toHaveLength(8);
    expect(clamped.things[0].fields).toHaveLength(15);
    expect(clamped.steps).toHaveLength(12);
    expect(clamped.steps[0]).toMatchObject({ roleId: null, thingId: null });
    expect(clamped.links).toEqual([]);
    expect(clamped.questions).toHaveLength(3);
  });

  it("loads stored material by id", async () => {
    expect(await loadMaterial(workdir, sheet.id)).toEqual(sheet);
    expect(await loadMaterial(workdir, "../../etc")).toBeNull();
    expect(await loadMaterial(workdir, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

const OWNER = "0x00000000000000000000000000000000000000aa";
const PROXIED = { "x-forwarded-for": "203.0.113.9", "x-forwarded-prefix": "/preview" };
const OWNER_AUTH = { ...PROXIED, authorization: "Bearer owner-token" };

describe("POST /workshop/understand", () => {
  let workdir: string;
  let cleanup: () => void;
  let server: Awaited<ReturnType<typeof startPreviewServer>>;
  let generate: UnderstandDeps["generate"];
  let modelConnected: boolean;
  const admins = process.env.ADMINS;

  beforeEach(async () => {
    process.env.ADMINS = OWNER;
    ({ workdir, cleanup } = makeWorkdir());
    modelConnected = true;
    generate = async () => reply(thing("Mangel"), 0.001);
    server = await startPreviewServer({
      services: { list: () => [], start: async () => "x", stop: async () => {} } as never,
      subscribe: () => {},
      workdir,
      renownUrl: "http://renown.invalid",
      port: 0,
      versions: { vetraCli: "test", ph: "test" },
      cloud: true,
      understandDeps: () => (modelConnected ? { generate: (req) => generate(req), ids } : null),
      authorizeRequest: createRequestAuthorizer({
        renownUrl: "http://renown.invalid",
        cloud: true,
        audience: () => "https://studio.example",
        verifyBearer: async (jwt) =>
          jwt === "owner-token" ? { address: OWNER, appDid: "did:key:z6Mk" } : false,
        verifyDelegation: async () => true,
      }),
    });
  });

  afterEach(async () => {
    await server.stop();
    cleanup();
    if (admins === undefined) delete process.env.ADMINS;
    else process.env.ADMINS = admins;
  });

  function post(body: unknown, headers: Record<string, string> = OWNER_AUTH) {
    return fetch(`http://127.0.0.1:${server.port}/workshop/understand`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("owner only", async () => {
    let called = false;
    generate = async () => {
      called = true;
      return reply(thing("X"));
    };
    const res = await post({ materialIds: [], text: "A list", language: "en" }, PROXIED);
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });

  it("returns what was understood", async () => {
    const m = await saveMaterial(workdir, { fileName: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("Defects per room") });
    const res = await post({ materialIds: [m.id], text: "", language: "en" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ notes: [], costUsd: 0.001, draft: { version: 1, language: "en" } });
  });

  it("budget error maps to 402", async () => {
    generate = async () => {
      throw new APICallError({
        message: "Insufficient credits",
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 402,
      });
    };
    const res = await post({ materialIds: [], text: "A list", language: "en" });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "budget" });
  });

  it("all inputs failing is 422 with the notes", async () => {
    generate = async () => ({ text: "no json here" });
    const res = await post({ materialIds: [], text: "A list", language: "en" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "unreadable",
      notes: [{ materialId: null, text: "Couldn't read your text. Describe it in a sentence instead." }],
    });
  });

  it("refuses bad requests", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ materialIds: [], text: "x", language: "fr" })).status).toBe(400);
    expect(await (await post({ materialIds: [], text: "  ", language: "en" })).json()).toEqual({ error: "empty" });
    const seven = Array.from({ length: 7 }, (_, i) => `00000000-0000-0000-0000-00000000000${i}`);
    expect(await (await post({ materialIds: seven, text: "", language: "en" })).json()).toEqual({ error: "too-many" });
    const unknown = await post({ materialIds: ["00000000-0000-0000-0000-000000000000"], text: "", language: "en" });
    expect(unknown.status).toBe(404);
    expect((await post("x".repeat(70 * 1024))).status).toBe(413);
  });

  it("no connected model is 503", async () => {
    modelConnected = false;
    const res = await post({ materialIds: [], text: "A list", language: "en" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "no-model" });
  });
});
