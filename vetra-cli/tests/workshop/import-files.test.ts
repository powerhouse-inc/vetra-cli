import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MAX_IMPORT_DOCUMENTS,
  readImports,
  validateImports,
} from "../../src/workshop/import-files.js";

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

const VALID = {
  source: { materialId: "mat-1", sheet: "Prüfliste" },
  documentType: "acme/todo-list",
  mapping: [{ column: "Aufgabe", field: "title" }],
  documents: [
    {
      name: "Küche — Riss",
      actions: [{ type: "ADD_TODO", input: { id: "row-1", title: "Küche — Riss" } }],
    },
    {
      name: "Bad — Fliese",
      actions: [{ type: "ADD_TODO", input: { id: "row-2", title: "Bad — Fliese" } }],
    },
  ],
};

describe("import files", () => {
  let workdir: string;
  let project: string;

  async function write(name: string, json: unknown): Promise<void> {
    const file = path.join(project, "import", name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      typeof json === "string" ? json : JSON.stringify(json, null, 2),
    );
  }

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "import-files-"));
    project = path.join(workdir, "todo-app");
    const model = path.join(project, "document-models", "todo-list", "todo-list.json");
    await fs.mkdir(path.dirname(model), { recursive: true });
    await fs.writeFile(model, JSON.stringify(MODEL, null, 2));
  });

  afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it("accepts a valid file and reads its documents", () => {
    return write("todo-list.json", VALID).then(() => {
      expect(validateImports(project)).toEqual([
        { file: "import/todo-list.json", ok: true },
      ]);
      const files = readImports(project).flatMap((read) =>
        read.ok ? [read.value] : [],
      );
      expect(files).toHaveLength(1);
      expect(files[0].source).toEqual({
        materialId: "mat-1",
        sheet: "Prüfliste",
      });
      expect(files[0].mapping).toEqual([{ column: "Aufgabe", field: "title" }]);
      expect(files[0].documents.map((d) => d.name)).toEqual([
        "Küche — Riss",
        "Bad — Fliese",
      ]);
    });
  });

  it("names the bad action", async () => {
    const bad = {
      ...VALID,
      documents: [
        {
          name: "Küche — Riss",
          actions: [
            { type: "ADD_TODO", input: { id: "row-1", title: "Küche — Riss" } },
            { type: "DELETE_ALL", input: {} },
          ],
        },
      ],
    };
    await write("todo-list.json", bad);
    const [check] = validateImports(project);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('document 1 "Küche — Riss", action 2');
    expect(check.reason).toContain("has no operation DELETE_ALL");
  });

  it("names a field the operation does not take", async () => {
    const bad = {
      ...VALID,
      documents: [
        {
          name: "Küche — Riss",
          actions: [
            { type: "ADD_TODO", input: { id: "row-1", priority: "HIGH" } },
          ],
        },
      ],
    };
    await write("todo-list.json", bad);
    const [check] = validateImports(project);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("action 1 ADD_TODO");
    expect(check.reason).toContain("title");
  });

  it("refuses more than 500 rows", async () => {
    const many = {
      ...VALID,
      documents: Array.from({ length: MAX_IMPORT_DOCUMENTS + 1 }, (_, i) => ({
        name: `Row ${i + 1}`,
        actions: [
          { type: "ADD_TODO", input: { id: `row-${i + 1}`, title: `Row ${i + 1}` } },
        ],
      })),
    };
    await write("todo-list.json", many);
    const [check] = validateImports(project);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("501 documents");
    expect(check.reason).toContain("500 or fewer");
  });

  it("refuses an unknown document type, a bad mapping and broken JSON", async () => {
    await write("other.json", { ...VALID, documentType: "acme/other" });
    await write("mapping.json", { ...VALID, mapping: [{ column: "A" }] });
    await write("broken.json", "{not json");
    expect(validateImports(project)).toEqual([
      {
        file: "import/broken.json",
        ok: false,
        reason: expect.stringContaining("not valid JSON"),
      },
      {
        file: "import/mapping.json",
        ok: false,
        reason: expect.stringContaining("mapping must be"),
      },
      {
        file: "import/other.json",
        ok: false,
        reason: expect.stringContaining("unknown document type"),
      },
    ]);
  });

  it("has nothing to check without an import directory", () => {
    expect(readImports(project)).toEqual([]);
    expect(validateImports(project)).toEqual([]);
  });
});
