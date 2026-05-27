import { describe, it, expect } from "@jest/globals";
import { join } from "node:path";
import { isModulePath } from "../../src/helpers/project-checks.js";

const base = "/proj";
const genFile = join(base, "document-models", "wt", "v1", "gen", "reducer.ts");
const reducerSrc = join(
  base,
  "document-models",
  "wt",
  "v1",
  "src",
  "reducers",
  "workouts.ts",
);
const editorSrc = join(base, "editors", "wt-editor", "components", "editor.tsx");
const appFile = join(base, "apps", "wt-app", "index.ts");
const rootFile = join(base, "vite.config.ts");

describe("isModulePath", () => {
  it("covers generated output", () => {
    expect(isModulePath(genFile)).toBe(true);
  });

  it("covers the editable reducer implementation outside gen/", () => {
    // The regression this guards: a malformed reducer lands here and must be
    // in scope so spec-generate's typecheck catches it.
    expect(isModulePath(reducerSrc)).toBe(true);
  });

  it("covers editor sources (no gen/ split)", () => {
    expect(isModulePath(editorSrc)).toBe(true);
  });

  it("covers app sources", () => {
    expect(isModulePath(appFile)).toBe(true);
  });

  it("excludes non-module project files", () => {
    expect(isModulePath(rootFile)).toBe(false);
  });
});
