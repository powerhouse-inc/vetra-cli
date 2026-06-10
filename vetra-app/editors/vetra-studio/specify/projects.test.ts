import type {
  FileNode,
  FolderNode,
} from "@powerhousedao/shared/document-drive";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_MODEL_TYPE,
  UNGROUPED_PROJECT_ID,
  UNGROUPED_PROJECT_NAME,
  deriveProjects,
} from "./projects.js";

function file(
  id: string,
  name: string,
  parentFolder: string | null,
  documentType = DOCUMENT_MODEL_TYPE,
): FileNode {
  return { id, name, kind: "file", documentType, parentFolder };
}

function folder(
  id: string,
  name: string,
  parentFolder: string | null = null,
): FolderNode {
  return { id, name, kind: "folder", parentFolder };
}

describe("deriveProjects", () => {
  it("returns [] for empty input", () => {
    expect(deriveProjects([], [])).toEqual([]);
  });

  it("groups one document under its folder", () => {
    const projects = deriveProjects(
      [file("m1", "Task", "f1")],
      [folder("f1", "task-board")],
    );
    expect(projects).toEqual([
      {
        id: "f1",
        name: "task-board",
        documents: [
          { id: "m1", name: "Task", documentType: DOCUMENT_MODEL_TYPE },
        ],
      },
    ]);
  });

  it("groups multiple documents in the same folder", () => {
    const projects = deriveProjects(
      [file("m2", "Invoice", "f1"), file("m1", "Task", "f1")],
      [folder("f1", "task-board")],
    );
    expect(projects).toHaveLength(1);
    expect(projects[0].documents.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("ignores files that are not SPECIFY_TYPES", () => {
    const projects = deriveProjects(
      [
        file("m1", "Task", "f1"),
        file("x1", "Chat", "f1", "powerhouse/chat-session"),
        file("x2", "Sheet", null, "powerhouse/brand-sheet"),
      ],
      [folder("f1", "task-board")],
    );
    expect(projects).toHaveLength(1);
    expect(projects[0].documents).toEqual([
      { id: "m1", name: "Task", documentType: DOCUMENT_MODEL_TYPE },
    ]);
  });

  it("puts orphan documents under Ungrouped (null parent and dangling parent)", () => {
    const projects = deriveProjects(
      [file("m1", "Loose", null), file("m2", "Dangling", "missing-folder")],
      [],
    );
    expect(projects).toEqual([
      {
        id: UNGROUPED_PROJECT_ID,
        name: UNGROUPED_PROJECT_NAME,
        documents: [
          { id: "m2", name: "Dangling", documentType: DOCUMENT_MODEL_TYPE },
          { id: "m1", name: "Loose", documentType: DOCUMENT_MODEL_TYPE },
        ],
      },
    ]);
  });

  it("omits folders with no documents", () => {
    const projects = deriveProjects(
      [file("m1", "Task", "f1")],
      [folder("f1", "task-board"), folder("f2", "empty-project")],
    );
    expect(projects.map((p) => p.id)).toEqual(["f1"]);
  });

  it("orders folders by name with Ungrouped last; documents by name", () => {
    const projects = deriveProjects(
      [
        file("m3", "Zeta", "fb"),
        file("m4", "Alpha", "fb"),
        file("m1", "Task", "fa"),
        file("m9", "Loose", null),
      ],
      [folder("fb", "beta"), folder("fa", "alpha")],
    );
    expect(projects.map((p) => p.name)).toEqual([
      "alpha",
      "beta",
      UNGROUPED_PROJECT_NAME,
    ]);
    expect(projects[1].documents.map((m) => m.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("groups document-model + document-editor + processor under one project with correct documentType per entry", () => {
    const projects = deriveProjects(
      [
        file("e1", "MyEditor", "f1", "powerhouse/document-editor"),
        file("m1", "MyModel", "f1", "powerhouse/document-model"),
        file("p1", "MyProc", "f1", "powerhouse/processor"),
      ],
      [folder("f1", "builders")],
    );
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe("f1");
    const docs = projects[0].documents;
    expect(docs).toHaveLength(3);
    expect(docs.find((d) => d.id === "e1")?.documentType).toBe(
      "powerhouse/document-editor",
    );
    expect(docs.find((d) => d.id === "m1")?.documentType).toBe(
      "powerhouse/document-model",
    );
    expect(docs.find((d) => d.id === "p1")?.documentType).toBe(
      "powerhouse/processor",
    );
  });

  it("includes subgraph and app types", () => {
    const projects = deriveProjects(
      [
        file("s1", "MySubgraph", "f1", "powerhouse/subgraph"),
        file("a1", "MyApp", "f1", "powerhouse/app"),
      ],
      [folder("f1", "platform")],
    );
    expect(projects).toHaveLength(1);
    const docs = projects[0].documents;
    expect(docs.find((d) => d.id === "s1")?.documentType).toBe(
      "powerhouse/subgraph",
    );
    expect(docs.find((d) => d.id === "a1")?.documentType).toBe(
      "powerhouse/app",
    );
  });

  it("excludes powerhouse/brand-sheet (ideation) and powerhouse/chat-session files", () => {
    const projects = deriveProjects(
      [
        file("b1", "BrandSheet", "f1", "powerhouse/brand-sheet"),
        file("c1", "ChatSession", "f1", "powerhouse/chat-session"),
        file("m1", "RealModel", "f1", "powerhouse/document-model"),
      ],
      [folder("f1", "mixed")],
    );
    expect(projects).toHaveLength(1);
    expect(projects[0].documents).toHaveLength(1);
    expect(projects[0].documents[0].id).toBe("m1");
  });

  it("ordering remains name-then-id across mixed SPECIFY_TYPES", () => {
    const projects = deriveProjects(
      [
        file("z-id", "Alpha", "f1", "powerhouse/processor"),
        file("a-id", "Alpha", "f1", "powerhouse/document-model"),
        file("m-id", "Beta", "f1", "powerhouse/subgraph"),
      ],
      [folder("f1", "proj")],
    );
    const docs = projects[0].documents;
    // Both "Alpha" entries: sorted by id after name tie
    expect(docs.map((d) => d.id)).toEqual(["a-id", "z-id", "m-id"]);
  });
});
