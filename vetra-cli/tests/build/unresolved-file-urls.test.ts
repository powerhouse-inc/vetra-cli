import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findUnresolvedFileUrls } from "../../scripts/unresolved-file-urls.js";

describe("findUnresolvedFileUrls", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "file-urls-"));
    mkdirSync(path.join(dir, "assets"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("flags rolldown/rollup file-URL placeholders left in shipped JS", () => {
    writeFileSync(
      path.join(dir, "assets", "pglite.js"),
      "async function Er(){let e=new URL(import.meta.ROLLDOWN_FILE_URL_DUq8Yoik,``+import.meta.url)}",
    );
    writeFileSync(path.join(dir, "old.js"), "x=import.meta.ROLLUP_FILE_URL_abc");
    expect(findUnresolvedFileUrls(dir)).toEqual([
      `${path.join(dir, "assets", "pglite.js")}: import.meta.ROLLDOWN_FILE_URL_DUq8Yoik`,
      `${path.join(dir, "old.js")}: import.meta.ROLLUP_FILE_URL_abc`,
    ]);
  });

  it("passes resolved asset URLs and ignores non-JS files", () => {
    writeFileSync(
      path.join(dir, "assets", "pglite.js"),
      "let e=new URL((globalThis.__PH_DYNAMIC_BASE__||`/`)+`assets/pglite-COscPi1Y.data`,``+import.meta.url)",
    );
    writeFileSync(path.join(dir, "assets", "x.js.map"), "import.meta.ROLLDOWN_FILE_URL_zz");
    expect(findUnresolvedFileUrls(dir)).toEqual([]);
  });
});
