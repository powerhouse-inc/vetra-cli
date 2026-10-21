import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { missingMarkers } from "../../src/product/marker-check.js";

let dir: string;
const write = (rel: string, src: string) => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, src);
};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "marker-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("missingMarkers", () => {
  it("lists editors without a component marker", () => {
    write("editors/notes/editor.tsx", "export default () => <div>hi</div>;");
    expect(missingMarkers(dir)).toEqual(["editors/notes/editor.tsx"]);
  });

  it("a marked editor passes", () => {
    write("editors/notes/editor.tsx", 'export default () => <div data-vetra-component="Notes" />;');
    expect(missingMarkers(dir)).toEqual([]);
  });

  it("accepts a marker in a sibling component file", () => {
    write("editors/notes/editor.tsx", "export default () => <Notes />;");
    write("editors/notes/Notes.tsx", '<div data-vetra-component="Notes" />');
    expect(missingMarkers(dir)).toEqual([]);
  });

  it("apps also need data-vetra-app", () => {
    write("editors/board/editor.tsx", "useSetPHAppConfig(c); export default () => <Board />;");
    write("editors/board/Board.tsx", '<div data-vetra-component="Board" />');
    expect(missingMarkers(dir)).toEqual(["editors/board/editor.tsx"]);
    write("editors/board/Board.tsx", '<div data-vetra-app data-vetra-component="Board" />');
    expect(missingMarkers(dir)).toEqual([]);
  });

  it("returns nothing without editors", () => {
    expect(missingMarkers(dir)).toEqual([]);
  });
});

describe("built skills", () => {
  it("teach the markers", () => {
    const editor = fs.readFileSync(
      path.resolve("prompts/skills-tpl/document-editor-creation/01.write-editor-implementation.md"),
      "utf8",
    );
    const app = fs.readFileSync(
      path.resolve("prompts/skills-tpl/drive-app-creation/01.write-app-implementation.md"),
      "utf8",
    );
    for (const s of [editor, app]) {
      expect(s).toContain("data-vetra-field");
      expect(s).toContain("data-vetra-component");
    }
    expect(app).toContain("data-vetra-app");
  });
});
