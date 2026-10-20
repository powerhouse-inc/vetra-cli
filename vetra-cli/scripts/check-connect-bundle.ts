// Guard: the shipped studio Connect bundle must have every bundler file-URL
// placeholder resolved (see unresolved-file-urls.ts). Fails the build otherwise.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findUnresolvedFileUrls } from "./unresolved-file-urls.ts";

const connectDir = resolve(import.meta.dirname, "..", "dist", "connect");
if (!existsSync(connectDir)) {
  console.error(`check-connect-bundle: ${connectDir} missing`);
  process.exit(1);
}
const hits = findUnresolvedFileUrls(connectDir);
if (hits.length > 0) {
  console.error(
    "check-connect-bundle: unresolved bundler file URLs in dist/connect " +
      "(rolldown older than builder-tools' vite? check the pnpm `rolldown` override):\n  " +
      hits.join("\n  "),
  );
  process.exit(1);
}
console.log("check-connect-bundle: ok");
