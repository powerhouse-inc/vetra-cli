import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { specPreviewCreate } from "../../src/commands/spec-preview/create.js";
import { specPreviewDelete } from "../../src/commands/spec-preview/delete.js";
import { specPreviewGet } from "../../src/commands/spec-preview/get.js";
import { specPreviewList } from "../../src/commands/spec-preview/list.js";
import { specPreviewUpdate } from "../../src/commands/spec-preview/update.js";
import { makeCtx, makeWorkdir } from "../spec/_fixtures.js";

const SWITCHBOARD_URL = "http://localhost:5555/graphql";

function withLiveReactorProject(workdir: string) {
  return {
    ...makeCtx(workdir),
    services: {
      list: () => [
        {
          status: "ready",
          workdir,
          endpoints: { "vetra-switchboard": SWITCHBOARD_URL },
        },
      ],
    } as never,
  };
}

function mockGqlResponses(
  fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>,
  responses: ReadonlyArray<Record<string, unknown>>,
) {
  let i = 0;
  fetchSpy.mockImplementation(() => {
    const payload = responses[i++] ?? {};
    return Promise.resolve(
      new Response(JSON.stringify({ data: payload }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

const SAMPLE_ITEM = {
  id: "doc-1",
  slug: "alpha",
  name: "Alpha",
  documentType: "powerhouse/document-model",
  revisionsList: [{ scope: "global", revision: 2 }],
};

const SAMPLE_FULL = {
  ...SAMPLE_ITEM,
  preferredEditor: null,
  state: { global: { name: "Alpha" }, local: {} },
};

describe("spec-preview command shapes", () => {
  it("specPreviewList exposes id and project field", () => {
    expect(specPreviewList.id).toBe("spec-preview-list");
    expect(specPreviewList.inputSchema.shape).toHaveProperty("project");
    expect(specPreviewList.inputSchema.shape).toHaveProperty("type");
  });

  it("specPreviewCreate exposes id, type, name", () => {
    expect(specPreviewCreate.id).toBe("spec-preview-create");
    expect(specPreviewCreate.inputSchema.shape).toHaveProperty("type");
    expect(specPreviewCreate.inputSchema.shape).toHaveProperty("name");
  });

  it("specPreviewGet exposes id, name, full, filter, format", () => {
    expect(specPreviewGet.id).toBe("spec-preview-get");
    expect(specPreviewGet.inputSchema.shape).toHaveProperty("name");
    expect(specPreviewGet.inputSchema.shape).toHaveProperty("full");
    expect(specPreviewGet.inputSchema.shape).toHaveProperty("filter");
  });

  it("specPreviewUpdate accepts inline actions or --from", () => {
    expect(specPreviewUpdate.id).toBe("spec-preview-update");
    expect(specPreviewUpdate.inputSchema.shape).toHaveProperty("actions");
    expect(specPreviewUpdate.inputSchema.shape).toHaveProperty("from");
  });

  it("specPreviewDelete exposes id and name", () => {
    expect(specPreviewDelete.id).toBe("spec-preview-delete");
    expect(specPreviewDelete.inputSchema.shape).toHaveProperty("name");
  });
});

describe("spec-preview commands without a running reactor-project", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("specPreviewList errors with no service manager in context", async () => {
    await expect(
      specPreviewList.execute({}, makeCtx(workdir)),
    ).rejects.toThrow(/service manager not available/i);
  });

  it("specPreviewCreate errors with no service manager", async () => {
    await expect(
      specPreviewCreate.execute(
        { type: "powerhouse/document-model", name: "X" },
        makeCtx(workdir),
      ),
    ).rejects.toThrow(/service manager not available/i);
  });
});

describe("spec-preview commands against a live (mocked) reactor-project", () => {
  let workdir: string;
  let cleanup: () => void;
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  beforeEach(() => {
    ({ workdir, cleanup } = makeWorkdir());
    fetchSpy = jest.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    cleanup();
  });

  it("specPreviewList renders a column row for each document and filters by --type", async () => {
    mockGqlResponses(fetchSpy, [
      {
        findDocuments: {
          items: [
            SAMPLE_ITEM,
            { ...SAMPLE_ITEM, id: "doc-2", name: "Beta", slug: "beta", documentType: "powerhouse/document-editor" },
          ],
        },
      },
    ]);
    const result = await specPreviewList.execute(
      {},
      withLiveReactorProject(workdir),
    );
    expect(result.text).toMatch(/Alpha/);
    expect(result.text).toMatch(/Beta/);
    expect(result.data?.documents).toHaveLength(2);

    mockGqlResponses(fetchSpy, [
      {
        findDocuments: {
          items: [
            SAMPLE_ITEM,
            { ...SAMPLE_ITEM, id: "doc-2", name: "Beta", slug: "beta", documentType: "powerhouse/document-editor" },
          ],
        },
      },
    ]);
    const filtered = await specPreviewList.execute(
      { type: "powerhouse/document-editor" },
      withLiveReactorProject(workdir),
    );
    expect(filtered.text).not.toMatch(/Alpha/);
    expect(filtered.text).toMatch(/Beta/);
    expect(filtered.data?.documents).toHaveLength(1);
  });

  it("specPreviewList reports (no preview documents) for an empty drive", async () => {
    mockGqlResponses(fetchSpy, [{ findDocuments: { items: [] } }]);
    const result = await specPreviewList.execute(
      {},
      withLiveReactorProject(workdir),
    );
    expect(result.text).toBe("(no preview documents)");
    expect(result.data?.documents).toEqual([]);
  });

  it("specPreviewGet returns a header summary by default", async () => {
    mockGqlResponses(fetchSpy, [
      { findDocuments: { items: [SAMPLE_ITEM] } },
      { document: { document: SAMPLE_FULL } },
    ]);
    const result = await specPreviewGet.execute(
      { name: "Alpha" },
      withLiveReactorProject(workdir),
    );
    expect(result.text).toMatch(/Alpha/);
    expect(result.data?.document?.header?.id).toBe("doc-1");
  });

  it("specPreviewGet projects state with --filter", async () => {
    mockGqlResponses(fetchSpy, [
      { findDocuments: { items: [SAMPLE_ITEM] } },
      { document: { document: SAMPLE_FULL } },
    ]);
    const result = await specPreviewGet.execute(
      { name: "Alpha", filter: "$.global.name" },
      withLiveReactorProject(workdir),
    );
    expect(result.text).toMatch(/Alpha/);
  });

  it("specPreviewCreate delegates to createEmptyDocument + renameDocument and accepts any document type", async () => {
    mockGqlResponses(fetchSpy, [
      { createEmptyDocument: { ...SAMPLE_FULL, name: "" } },
      { renameDocument: { ...SAMPLE_FULL, name: "Alpha" } },
    ]);
    const result = await specPreviewCreate.execute(
      {
        type: "powerhouse/workout-tracker",
        name: "Alpha",
      },
      withLiveReactorProject(workdir),
    );
    expect(result.text).toMatch(/Created/);
    expect(result.data?.document?.header?.id).toBe("doc-1");
    expect(result.data?.document?.header?.name).toBe("Alpha");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const createBody = JSON.parse(
      String(fetchSpy.mock.calls[0]?.[1]?.body ?? "{}"),
    ) as { query: string; variables: Record<string, unknown> };
    expect(createBody.query).toMatch(/createEmptyDocument/);
    expect(createBody.variables.documentType).toBe("powerhouse/workout-tracker");
    expect(createBody.variables.parentIdentifier).toBeDefined();
    const renameBody = JSON.parse(
      String(fetchSpy.mock.calls[1]?.[1]?.body ?? "{}"),
    ) as { query: string; variables: Record<string, unknown> };
    expect(renameBody.query).toMatch(/renameDocument/);
    expect(renameBody.variables.name).toBe("Alpha");
    expect(renameBody.variables.documentIdentifier).toBe("doc-1");
  });

  it("specPreviewUpdate looks up the doc then posts mutateDocument", async () => {
    mockGqlResponses(fetchSpy, [
      { findDocuments: { items: [SAMPLE_ITEM] } },
      {
        mutateDocument: {
          ...SAMPLE_FULL,
          revisionsList: [{ scope: "global", revision: 3 }],
        },
      },
    ]);
    const result = await specPreviewUpdate.execute(
      {
        name: "Alpha",
        actions: [{ type: "SET_NAME", input: { name: "Renamed" } }],
      },
      withLiveReactorProject(workdir),
    );
    expect(result.text).toMatch(/Applied 1 action/);
    expect(result.data?.document?.operationsCount).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const mutateBody = JSON.parse(
      String(fetchSpy.mock.calls[1]?.[1]?.body ?? "{}"),
    ) as { variables: { actions: Array<Record<string, unknown>> } };
    const [sentAction] = mutateBody.variables.actions;
    expect(typeof sentAction.id).toBe("string");
    expect(sentAction.id).toBeTruthy();
    expect(typeof sentAction.timestampUtcMs).toBe("string");
    expect(() => new Date(sentAction.timestampUtcMs as string).toISOString()).not.toThrow();
    expect(sentAction.scope).toBe("global");
    expect(sentAction.type).toBe("SET_NAME");
  });

  it("specPreviewDelete looks up the doc then posts deleteDocument", async () => {
    mockGqlResponses(fetchSpy, [
      { findDocuments: { items: [SAMPLE_ITEM] } },
      { deleteDocument: true },
    ]);
    const result = await specPreviewDelete.execute(
      { name: "Alpha" },
      withLiveReactorProject(workdir),
    );
    expect(result.text).toMatch(/Deleted "Alpha"/);
    expect(result.data?.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
