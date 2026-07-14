// Streams a zip of the workdir into a writable for debugging / sharing with
// support. Independent of any session — the workspace is shared across all.
import type { Dirent } from "node:fs";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Writable } from "node:stream";
import { AsyncZipDeflate, Zip } from "fflate";

export const WORKSPACE_ZIP_FILENAME = "vetra-workspace.zip";

// Dir names skipped anywhere in the walk: dep trees, build/cache output, the
// `.git` repo (history/config can leak secrets), and the `.ph` credential store.
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".turbo",
  ".cache",
  ".git",
  ".ph",
]);

// Secret-bearing files kept out of a shareable zip (.env, .env.*, .envrc, …).
function isExcludedFile(name: string): boolean {
  return name.startsWith(".env");
}

interface WorkspaceEntry {
  abs: string;
  name: string;
}

// Yield each workspace file as `{ abs, workspace/<relpath> }`. Symlinks are
// neither file nor dir here, so the walk can't escape workdir or loop.
async function* walkWorkspace(workdir: string): AsyncGenerator<WorkspaceEntry> {
  async function* walk(dir: string): AsyncGenerator<WorkspaceEntry> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        yield* walk(abs);
      } else if (entry.isFile()) {
        if (isExcludedFile(entry.name)) continue;
        const rel = relative(workdir, abs).split(sep).join("/");
        yield { abs, name: `workspace/${rel}` };
      }
    }
  }
  yield* walk(workdir);
}

// Read one file into the zip entry, copying each chunk (fs pool buffers would
// be detached by fflate's worker transfer) and pausing while `out` is backed up.
function pumpFile(abs: string, entry: AsyncZipDeflate, out: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const rs = createReadStream(abs);
    let onDrain: (() => void) | undefined;
    const cleanup = () => {
      out.removeListener("close", onAbort);
      out.removeListener("error", onAbort);
      if (onDrain) out.removeListener("drain", onDrain);
    };
    // A dead output aborts this file — destroy the read so it can't hang paused
    // on a 'drain' that will never fire, leaking the fd.
    const onAbort = () => {
      cleanup();
      rs.destroy();
      reject(new Error("output stream closed"));
    };
    out.once("close", onAbort);
    out.once("error", onAbort);
    rs.on("data", (chunk: Buffer) => {
      entry.push(new Uint8Array(chunk), false);
      if (out.writableNeedDrain) {
        rs.pause();
        onDrain = () => {
          onDrain = undefined;
          rs.resume();
        };
        out.once("drain", onDrain);
      }
    });
    rs.on("end", () => {
      entry.push(new Uint8Array(0), true);
      cleanup();
      resolve();
    });
    rs.on("error", (err) => {
      cleanup();
      reject(err);
    });
  });
}

// Stream a zip of `workdir` into `out`. Deflate runs on fflate's worker pool
// (main thread free); on abort/error the workers are terminated (see `finish`).
export async function streamWorkspaceExport(
  workdir: string,
  out: Writable,
): Promise<{ fileCount: number }> {
  let fileCount = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      out.removeListener("error", onErr);
      out.removeListener("close", onClose);
      if (err) {
        // Kill in-flight workers: stops post-abort ondata (write-after-destroy)
        // and frees the threads. Safe if the zip already ended.
        try {
          zip.terminate();
        } catch {
          // already terminated / ended
        }
        reject(err);
      } else {
        resolve();
      }
    };
    const onErr = (err: Error) => finish(err);
    const onClose = () => finish(new Error("output stream closed"));
    out.on("error", onErr);
    out.once("close", onClose);

    const zip = new Zip((err, chunk, final) => {
      // Ignore worker output that arrives after an abort — `out` may be dead.
      if (settled) return;
      if (err) {
        finish(err);
        return;
      }
      out.write(Buffer.from(chunk));
      if (final) finish();
    });

    void (async () => {
      try {
        for await (const { abs, name } of walkWorkspace(workdir)) {
          if (settled) return;
          const entry = new AsyncZipDeflate(name, { level: 6 });
          zip.add(entry);
          await pumpFile(abs, entry, out);
          fileCount++;
        }
        if (!settled) zip.end();
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
  return { fileCount };
}
