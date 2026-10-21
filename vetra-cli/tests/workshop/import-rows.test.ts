import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { StudioProductV1 } from "vetra-app/document-models";
import {
  listImports,
  runImport,
  type ImportRowsContext,
} from "../../src/workshop/import-rows.js";
import { productHarness, type ProductHarness } from "../product/helpers.js";

const a = StudioProductV1.actions;
const MODEL = {
  id: "acme/todo-list",
  name: "TodoList",
  extension: ".todo",
  description: "",
  author: { name: "", website: "" },
  specifications: [
    {
      version: 1,
      changeLog: [],
      state: {
        global: {
          schema:
            "type TodoListState {\n  todos: [Todo!]!\n}\n\ntype Todo {\n  id: OID!\n  title: String!\n}",
          initialValue: '{"todos":[]}',
          examples: [],
        },
        local: { schema: "", initialValue: "", examples: [] },
      },
      modules: [
        {
          id: "m1",
          name: "todos",
          description: "",
          operations: [
            {
              id: "o1",
              name: "ADD_TODO",
              scope: "global",
              schema: "input AddTodoInput {\n  id: OID!\n  title: String!\n}",
              description: "",
              template: "",
              reducer: "",
              errors: [],
              examples: [],
            },
          ],
        },
      ],
    },
  ],
};

const IMPORT = {
  source: { materialId: "mat-1", sheet: "Prüfliste" },
  documentType: "acme/todo-list",
  mapping: [{ column: "Aufgabe", field: "title" }],
  documents: [
    {
      name: "Küche — Riss",
      actions: [{ type: "ADD_TODO", input: { id: "r1", title: "Küche — Riss" } }],
    },
    {
      name: "Bad — Fliese",
      actions: [{ type: "ADD_TODO", input: { id: "r2", title: "Bad — Fliese" } }],
    },
  ],
};

interface FakeDrive {
  created: { documentType: string; name: string }[];
  applied: { id: string; type: string; scope: string }[];
  failOn?: number;
}

function fakeDrive(): FakeDrive & {
  driveClient: ImportRowsContext["driveClient"];
} {
  const drive: FakeDrive & {
    driveClient: ImportRowsContext["driveClient"];
  } = { created: [], applied: [], driveClient: undefined };
  let n = 0;
  drive.driveClient = async () => ({
    findDrive: async () => null,
    getProtection: async () => false,
    createDrive: async () => "drive-live",
    listDocuments: async () => [],
    createDocument: async (_driveId, input) => {
      if (drive.failOn === drive.created.length) {
        throw new Error("server said no");
      }
      drive.created.push(input);
      return `doc-${++n}`;
    },
    applyActions: async (id, actions) => {
      for (const action of actions) {
        drive.applied.push({ id, type: action.type, scope: action.scope });
      }
    },
    setProtection: async () => {},
  });
  return drive;
}

describe("row imports", () => {
  let workdir: string;
  let project: string;
  let harness: ProductHarness;
  let drive: FakeDrive & { driveClient: ImportRowsContext["driveClient"] };
  let ctx: ImportRowsContext;

  async function write(rel: string, json: unknown): Promise<void> {
    const file = path.join(project, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(json, null, 2));
  }

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "row-imports-"));
    project = path.join(workdir, "todo-app");
    await write("powerhouse.config.json", {});
    await write("document-models/todo-list/todo-list.json", MODEL);
    await write("import/todo-list.json", IMPORT);
    await fs.mkdir(path.join(workdir, ".ph"), { recursive: true });
    await fs.writeFile(
      path.join(workdir, ".ph", "product-drive.json"),
      JSON.stringify({
        driveId: "drive-live",
        switchboardUrl: "https://switchboard.example",
      }),
    );
    harness = await productHarness({ name: "Todo App" });
    await harness.module.client.execute(harness.productId!, "main", [
      a.setProductDrive({ driveId: "drive-live", liveUrl: "https://todo.example" }),
    ]);
    drive = fakeDrive();
    ctx = {
      ...harness.ctx,
      workdir,
      config: {
        cloudSwitchboardUrl: "https://switchboard.example",
        cloudRenownUrl: undefined,
        environmentId: undefined,
      },
      driveClient: drive.driveClient,
    };
  });

  afterEach(async () => {
    await harness.kill();
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it("offers the import with its mapping and row count", async () => {
    const [offer] = await listImports(ctx);
    expect(offer).toMatchObject({
      file: "import/todo-list.json",
      materialName: "mat-1",
      sheet: "Prüfliste",
      documentType: "acme/todo-list",
      rows: 2,
      mapping: [{ column: "Aufgabe", field: "title" }],
      done: 0,
    });
  });

  it("imports every row as the owner and records progress on the product", async () => {
    const result = await runImport(ctx, "import/todo-list.json");

    expect(result).toEqual({ imported: 2, failed: 0 });
    expect(drive.created.map((d) => d.name)).toEqual([
      "Küche — Riss",
      "Bad — Fliese",
    ]);
    expect(drive.applied).toEqual([
      { id: "doc-1", type: "ADD_TODO", scope: "global" },
      { id: "doc-2", type: "ADD_TODO", scope: "global" },
    ]);
    const rowImport = (await harness.state()).rowImports[0];
    expect(rowImport).toMatchObject({
      id: "row-import-todo-list",
      materialId: "mat-1",
      sheet: "Prüfliste",
      documentType: "acme/todo-list",
      rows: 2,
      imported: 2,
      status: "DONE",
    });
    const progress = JSON.parse(
      await fs.readFile(
        path.join(workdir, ".ph", "vetra", "workshop", "imports", "todo-list.json"),
        "utf-8",
      ),
    ) as { imported: number[] };
    expect(progress.imported).toEqual([0, 1]);
    expect(await listImports(ctx)).toMatchObject([{ done: 2 }]);
  });

  it("a second run after a failure creates only the missing rows", async () => {
    drive.failOn = 1;
    const first = await runImport(ctx, "import/todo-list.json");
    expect(first).toEqual({ imported: 1, failed: 1 });
    expect((await harness.state()).rowImports[0]).toMatchObject({
      imported: 1,
      status: "FAILED",
    });

    delete drive.failOn;
    const second = await runImport(ctx, "import/todo-list.json");

    expect(second).toEqual({ imported: 2, failed: 0 });
    expect(drive.created.map((d) => d.name)).toEqual([
      "Küche — Riss",
      "Bad — Fliese",
    ]);
    expect((await harness.state()).rowImports[0]).toMatchObject({
      imported: 2,
      status: "DONE",
    });
  });

  it("refuses a file that is not a valid import", async () => {
    await expect(runImport(ctx, "import/nope.json")).rejects.toMatchObject({
      code: "unknown-file",
    });
  });
});
