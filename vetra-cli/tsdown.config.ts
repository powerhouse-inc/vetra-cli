import { defineConfig } from "tsdown";

// Rewrite bundled CJS deps' bare __dirname/__filename (undefined in ESM, only
// inconsistently rewritten by rolldown) to Node 22 native import.meta.*.
const dirnameShim = {
  name: "esm-dirname-shim",
  renderChunk(code: string) {
    if (!/\b__(?:dir|file)name\b/.test(code)) return null;
    const out = code
      .replace(/\b(?:const|let|var)\s+__dirname\s*=\s*[^;\n]*;/g, "")
      .replace(/\b(?:const|let|var)\s+__filename\s*=\s*[^;\n]*;/g, "")
      .replace(/\b__dirname\b/g, "import.meta.dirname")
      .replace(/\b__filename\b/g, "import.meta.filename");
    return out === code ? null : out;
  },
};

// Bundle the CLI so a global install pulls only external runtime deps. tsdown
// externalizes dependencies + peerDependencies; leaf devDeps get inlined.
export default defineConfig({
  // ph-version.gen.ts is a separate entry so the Dockerfile can read
  // dist/ph-version.gen.js (DEFAULT_PH_VERSION) standalone, not only inlined.
  entry: ["src/main.ts", "src/ph-version.gen.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: false,
  // build:assets writes dist/gen + manifest first; build wipes dist up front.
  clean: false,
  // OpenTelemetry + devcert do dynamic platform requires that don't survive
  // bundling; keep them external (declared as deps) so they resolve at runtime.
  external: [/^@opentelemetry\//, "devcert"],
  plugins: [dirnameShim],
  // bin/start/Dockerfile expect dist/main.js (ESM via package "type": "module").
  outputOptions: {
    entryFileNames: "[name].js",
    chunkFileNames: "[name]-[hash].js",
  },
});
