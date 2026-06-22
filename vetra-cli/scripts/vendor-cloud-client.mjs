// Copies the tsdown cloud-client bundle over the tsc-emitted dist/cloud/_cloud-client.*
// so the shipped CLI inlines @powerhousedao/vetra-cloud-client (and its
// @powerhousedao/vetra-cloud-package dep) instead of importing them at runtime.
// Run by `build:cloud-client` after tsc. See src/cloud/_cloud-client.ts and
// tsdown.cloud-client.config.ts.
import { copyFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = resolve(root, "dist/.cloud-client-vendor");
const srcJs = resolve(tmp, "_cloud-client.mjs");
const srcDts = resolve(tmp, "_cloud-client.d.mts");
const destJs = resolve(root, "dist/cloud/_cloud-client.js");
const destDts = resolve(root, "dist/cloud/_cloud-client.d.ts");

if (!existsSync(srcJs)) {
  console.error(`[vendor-cloud-client] missing bundle: ${srcJs} — did tsdown run?`);
  process.exit(1);
}
copyFileSync(srcJs, destJs);
if (existsSync(srcDts)) copyFileSync(srcDts, destDts);
rmSync(tmp, { recursive: true, force: true });
console.log("[vendor-cloud-client] inlined vetra-cloud-client into dist/cloud/_cloud-client.js");
