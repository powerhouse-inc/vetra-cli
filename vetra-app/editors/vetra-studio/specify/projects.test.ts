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

  it("groups one model under its folder", () => {
    const projects = deriveProjects(
      [file("m1", "Task", "f1")],
      [folder("f1", "task-board")],
    );
    expect(projects).toEqual([
      { id: "f1", name: "task-board", models: [{ id: "m1", name: "Task" }] },
    ]);
  });

  it("groups multiple models in the same folder", () => {
    const projects = deriveProjects(
      [file("m2", "Invoice", "f1"), file("m1", "Task", "f1")],
      [folder("f1", "task-board")],
    );
    expect(projects).toHaveLength(1);
    expect(projects[0].models.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("ignores files that are not document-models", () => {
    const projects = deriveProjects(
      [
        file("m1", "Task", "f1"),
        file("x1", "Chat", "f1", "powerhouse/chat-session"),
        file("x2", "Sheet", null, "powerhouse/brand-sheet"),
      ],
      [folder("f1", "task-board")],
    );
    expect(projects).toHaveLength(1);
    expect(projects[0].models).toEqual([{ id: "m1", name: "Task" }]);
  });

  it("puts orphan models under Ungrouped (null parent and dangling parent)", () => {
    const projects = deriveProjects(
      [file("m1", "Loose", null), file("m2", "Dangling", "missing-folder")],
      [],
    );
    expect(projects).toEqual([
      {
        id: UNGROUPED_PROJECT_ID,
        name: UNGROUPED_PROJECT_NAME,
        models: [
          { id: "m2", name: "Dangling" },
          { id: "m1", name: "Loose" },
        ],
      },
    ]);
  });

  it("omits folders with no models", () => {
    const projects = deriveProjects(
      [file("m1", "Task", "f1")],
      [folder("f1", "task-board"), folder("f2", "empty-project")],
    );
    expect(projects.map((p) => p.id)).toEqual(["f1"]);
  });

  it("orders folders by name with Ungrouped last; models by name", () => {
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
    expect(projects[1].models.map((m) => m.name)).toEqual(["Alpha", "Zeta"]);
  });
});
