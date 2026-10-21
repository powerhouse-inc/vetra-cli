import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import {
  InvalidSnapshotKeyError,
  listSnapshots,
  saveSnapshot,
  SnapshotTooLargeError,
  SNAPSHOT_MAX_BYTES,
} from "../../src/workshop/snapshots-store.js";
import { makeWorkdir } from "../spec/_fixtures.js";

describe("snapshots store", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ workdir, cleanup } = makeWorkdir());
  });
  afterEach(() => cleanup());

  it("keeps order by time", async () => {
    await saveSnapshot(workdir, "c1", "2026-10-21T10:00:40.000Z", Buffer.from("b"));
    await saveSnapshot(workdir, "c1", "2026-10-21T10:00:20.000Z", Buffer.from("a"));
    await saveSnapshot(workdir, "c2", "2026-10-21T09:00:00.000Z", Buffer.from("x"));
    const list = await listSnapshots(workdir, "c1");
    expect(list.map((s) => s.at)).toEqual(["2026-10-21T100020000Z", "2026-10-21T100040000Z"]);
    expect(
      readFileSync(join(workdir, ".ph", "vetra", "snapshots", "c1", list[0].file), "utf8"),
    ).toBe("a");
    expect(await listSnapshots(workdir, "none")).toEqual([]);
  });

  it("refuses > 400 KB", async () => {
    await expect(
      saveSnapshot(workdir, "c1", "2026-10-21T10:00:00Z", Buffer.alloc(SNAPSHOT_MAX_BYTES + 1)),
    ).rejects.toBeInstanceOf(SnapshotTooLargeError);
    await saveSnapshot(workdir, "c1", "2026-10-21T10:00:00Z", Buffer.alloc(SNAPSHOT_MAX_BYTES));
  });

  it("refuses keys that are not path-safe", async () => {
    await expect(saveSnapshot(workdir, "../x", "2026-10-21T10:00:00Z", Buffer.from("a"))).rejects.toBeInstanceOf(
      InvalidSnapshotKeyError,
    );
    await expect(saveSnapshot(workdir, "c1", "../../etc", Buffer.from("a"))).rejects.toBeInstanceOf(
      InvalidSnapshotKeyError,
    );
  });
});
