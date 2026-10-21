/**
 * Preview snapshots taken during a build (for the time-lapse), stored as
 * `<workdir>/.ph/vetra/snapshots/<changeId>/<at>.jpg`.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SNAPSHOT_MAX_BYTES = 400 * 1024;

export class SnapshotTooLargeError extends Error {
  constructor() {
    super(`snapshot over ${SNAPSHOT_MAX_BYTES} bytes`);
    this.name = "SnapshotTooLargeError";
  }
}

export class InvalidSnapshotKeyError extends Error {
  constructor(what: string) {
    super(`invalid snapshot ${what}`);
    this.name = "InvalidSnapshotKeyError";
  }
}

export function snapshotsDir(workdir: string): string {
  return join(workdir, ".ph", "vetra", "snapshots");
}

/** A change id becomes a path segment: letters, digits, `_` and `-` only. */
export function safeChangeId(changeId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(changeId)) throw new InvalidSnapshotKeyError("change");
  return changeId;
}

/** An ISO-ish timestamp, normalised to digits, `-`, `T` and `Z` (`:`/`.` dropped). */
export function safeAt(at: string): string {
  const clean = at.replace(/[:.]/g, "");
  if (!/^\d{4}-?\d{2}-?\d{2}T\d{4,6}\d{0,3}Z?$/.test(clean)) throw new InvalidSnapshotKeyError("time");
  return clean;
}

export async function saveSnapshot(
  workdir: string,
  changeId: string,
  at: string,
  bytes: Buffer,
): Promise<string> {
  const id = safeChangeId(changeId);
  const stamp = safeAt(at);
  if (bytes.length > SNAPSHOT_MAX_BYTES) throw new SnapshotTooLargeError();
  const dir = join(snapshotsDir(workdir), id);
  await mkdir(dir, { recursive: true });
  const file = `${stamp}.jpg`;
  await writeFile(join(dir, file), bytes);
  return file;
}

/** The change's snapshots, oldest first (the names sort by time). */
export async function listSnapshots(
  workdir: string,
  changeId: string,
): Promise<{ at: string; file: string }[]> {
  const id = safeChangeId(changeId);
  let names: string[];
  try {
    names = await readdir(join(snapshotsDir(workdir), id));
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".jpg"))
    .map((file) => ({ at: file.slice(0, -4), file }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
