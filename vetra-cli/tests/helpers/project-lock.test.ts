import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withProjectCodegenLock } from "../../src/helpers/project-lock.js";

describe("withProjectCodegenLock", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "codegen-lock-"));
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("serializes concurrent runs against the same project", async () => {
    let active = 0;
    let maxActive = 0;
    const task = (id: string) =>
      withProjectCodegenLock(base, async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 40));
        active--;
        return id;
      });

    const results = await Promise.all([task("a"), task("b"), task("c")]);

    expect(maxActive).toBe(1);
    expect(results.sort()).toEqual(["a", "b", "c"]);
  }, 15_000);

  it("releases the lock so a later run can re-acquire", async () => {
    await withProjectCodegenLock(base, async () => "first");
    const second = await withProjectCodegenLock(base, async () => "second");
    expect(second).toBe("second");
    // Lock dir removed after release.
    await expect(
      fs.stat(path.join(base, ".ph", "codegen.lock")),
    ).rejects.toBeTruthy();
  }, 15_000);

  it("releases the lock when the critical section throws", async () => {
    await expect(
      withProjectCodegenLock(base, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // A subsequent run still acquires (lock was released on error).
    const after = await withProjectCodegenLock(base, async () => "ok");
    expect(after).toBe("ok");
  }, 15_000);

  it("does not block runs for different projects", async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "codegen-lock-b-"));
    try {
      let bothActive = false;
      const a = withProjectCodegenLock(base, async () => {
        await new Promise((r) => setTimeout(r, 60));
        return "a";
      });
      const b = withProjectCodegenLock(other, async () => {
        // If the two projects don't share a lock, this overlaps with `a`.
        bothActive = true;
        return "b";
      });
      await Promise.all([a, b]);
      expect(bothActive).toBe(true);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  }, 15_000);
});
