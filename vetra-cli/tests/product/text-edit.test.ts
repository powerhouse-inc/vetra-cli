import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLiteral, rewriteLiteral } from "../../src/product/text-edit.js";

let dir: string;

function write(rel: string, source: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, source);
}

const read = (rel: string): string => fs.readFileSync(path.join(dir, rel), "utf8");

/** The file with its one match replaced, or null when the match isn't whole. */
function rewrite(rel: string, oldText: string, newText: string): string | null {
  const matches = findLiteral(dir, oldText);
  if (matches.length !== 1) return null;
  return rewriteLiteral(read(rel), matches[0].index, oldText, newText);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "text-edit-"));
  write("app/powerhouse.config.json", "{}\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("findLiteral", () => {
  it("finds exactly one JSX text match", () => {
    write(
      "app/editors/notes/editor.tsx",
      'export const E = () => <button className="save">Save</button>;\n',
    );

    const matches = findLiteral(dir, "Save");
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe("app/editors/notes/editor.tsx");
    expect(rewrite("app/editors/notes/editor.tsx", "Save", "Send")).toContain(
      '<button className="save">Send</button>',
    );
  });

  it("counts a literal inside a longer string as ambiguous", () => {
    write("app/editors/notes/editor.tsx", "<button>Save</button>\n");
    write("app/editors/notes/labels.ts", 'export const label = "Save changes";\n');

    expect(findLiteral(dir, "Save")).toHaveLength(2);
  });

  it("does not find a literal only in gen/", () => {
    write("app/editors/notes/gen/Widget.tsx", "<button>Save</button>\n");
    expect(findLiteral(dir, "Save")).toEqual([]);
  });

  it("two matches go to the agent", () => {
    write("app/editors/a/editor.tsx", "<button>Save</button>\n");
    write("app/editors/b/editor.tsx", "<button>Save</button>\n");
    expect(findLiteral(dir, "Save")).toHaveLength(2);
  });

  it("compares HTML entities and whitespace", () => {
    write("app/apps/notes/editor.tsx", "<p>\n  Save   &amp; close\n</p>\n");

    const matches = findLiteral(dir, "Save & close");
    expect(matches).toHaveLength(1);
    const next = rewrite("app/apps/notes/editor.tsx", "Save & close", "Save & exit");
    // The whole text node (with its surrounding whitespace) is replaced.
    expect(next).toBe("<p>Save & exit</p>\n");
  });

  it("a whole string literal is edited", () => {
    write("app/editors/notes/editor.tsx", 'const title = "Save";\n');

    expect(rewrite("app/editors/notes/editor.tsx", "Save", "Send")).toBe(
      'const title = "Send";\n',
    );
  });

  it("never rewrites part of a longer string", () => {
    write("app/editors/notes/editor.tsx", 'const label = "Save changes";\n');
    const matches = findLiteral(dir, "Save");
    expect(matches).toHaveLength(1);

    expect(
      rewriteLiteral(read("app/editors/notes/editor.tsx"), matches[0].index, "Save", "Send"),
    ).toBeNull();
  });

  it("ignores test files and node_modules", () => {
    write("app/editors/notes/editor.test.tsx", 'const t = "Save";\n');
    write("app/editors/notes/node_modules/x.tsx", 'const t = "Save";\n');
    expect(findLiteral(dir, "Save")).toEqual([]);
  });
});
