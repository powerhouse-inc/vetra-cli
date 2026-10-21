import { findBareDynamicImports } from "../../scripts/dynamic-imports.js";
import { VENDOR } from "../../scripts/vendor-list.js";

describe("findBareDynamicImports", () => {
  it("finds the unbundled import rolldown leaves for @mastra/core's shell", () => {
    // The shape in dist after rolldown inlines `const mod = "execa"`.
    const code = `const execa = (await import(\n\t/* @vite-ignore */\n\t/* webpackIgnore: true */\n\t"execa"\n)).execa;`;
    expect(findBareDynamicImports(code)).toEqual(["execa"]);
  });

  it("ignores relative chunks, docs text and template specifiers", () => {
    const code = [
      `await import("./chunk-abc.js")`,
      `* const { Agent } = await import('@mastra/core/agent');`,
      `import(/* @vite-ignore */ "./local.js")`,
      `import(/* @vite-ignore */ "\${path}")`,
    ].join("\n");
    expect(findBareDynamicImports(code)).toEqual([]);
  });

  it("vendors execa so the workspace shell works in a global install", () => {
    expect(VENDOR).toContain("execa");
  });
});
