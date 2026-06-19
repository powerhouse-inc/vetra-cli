import { defineConfig } from "tsdown";

/**
 * Vendor bundle for the shared cloud client. Bundles
 * `@powerhousedao/vetra-cloud-client` (and its `@powerhousedao/vetra-cloud-package`
 * dep) into one self-contained module that `build:cloud-client` copies over the
 * tsc-emitted `dist/cloud/_cloud-client.js`. This keeps the shared client a
 * LOCAL, unpublished workspace package: its code is inlined into the shipped CLI
 * so the published tarball has no external reference to it.
 *
 * reactor-browser + document-model stay external (tsdown auto-externalizes
 * vetra-cli's deps, where both are listed); vetra-cloud-client is a devDep and
 * vetra-cloud-package isn't a vetra-cli dep, so both get bundled.
 *
 * Output goes to a temp dir; scripts/vendor-cloud-client.mjs renames the .mjs/.d.mts
 * to the .js/.d.ts names tsc emits and the relative imports resolve.
 */
export default defineConfig({
  entry: ["src/cloud/_cloud-client.ts"],
  outDir: "dist/.cloud-client-vendor",
  format: ["esm"],
  dts: true,
  clean: true,
  deps: { neverBundle: ["@powerhousedao/reactor-browser", "document-model"] },
  // Emit ONE self-contained file. A dynamic import() in the dep graph otherwise
  // code-splits into sibling chunks the copy step would leave dangling.
  // (tsdown flags this deprecated in favor of `codeSplitting: false`, but that
  // option does not actually collapse the chunks here — this one does.)
  outputOptions: { inlineDynamicImports: true },
});
