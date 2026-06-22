import { defineConfig } from "tsdown";

// reactor-browser / document-model (peers) and vetra-cloud-package (dep) are
// auto-externalized by tsdown; the latter resolves its own node/browser
// condition at the consumer.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
});
