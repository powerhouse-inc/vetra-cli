import { describe, expect, it } from "vitest";
import {
  frameHash,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_MAX,
  shouldSnapshot,
} from "./snapshots.js";

const base = {
  lastAt: 0,
  lastHash: "a",
  now: SNAPSHOT_INTERVAL_MS,
  hash: "b",
  building: true,
  count: 1,
};

describe("shouldSnapshot", () => {
  it("takes the first one and any changed one after the interval", () => {
    expect(shouldSnapshot({ ...base, lastAt: null, lastHash: null })).toBe(
      true,
    );
    expect(shouldSnapshot(base)).toBe(true);
  });
  it("no snapshot while nothing changed", () => {
    expect(shouldSnapshot({ ...base, hash: "a" })).toBe(false);
  });
  it("at most one per 20 s", () => {
    expect(shouldSnapshot({ ...base, now: SNAPSHOT_INTERVAL_MS - 1 })).toBe(
      false,
    );
  });
  it("stops at 60", () => {
    expect(shouldSnapshot({ ...base, count: SNAPSHOT_MAX })).toBe(false);
    expect(shouldSnapshot({ ...base, count: SNAPSHOT_MAX - 1 })).toBe(true);
  });
  it("only while building", () => {
    expect(shouldSnapshot({ ...base, building: false })).toBe(false);
  });
});

describe("frameHash", () => {
  it("changes with text or child count", () => {
    const a = frameHash({ innerText: "x", childElementCount: 1 });
    expect(frameHash({ innerText: "y", childElementCount: 1 })).not.toBe(a);
    expect(frameHash({ innerText: "x", childElementCount: 2 })).not.toBe(a);
    expect(frameHash({ innerText: "x", childElementCount: 1 })).toBe(a);
  });
});

describe("captureFrame", () => {
  it("failed capture is ignored: no document means nothing to take", async () => {
    const { captureFrame } = await import("./useSnapshots.js");
    expect(captureFrame(null)).toBeNull();
    const cross = {
      get contentDocument(): never {
        throw new DOMException("blocked", "SecurityError");
      },
    } as unknown as HTMLIFrameElement;
    expect(captureFrame(cross)).toBeNull();
    expect(
      captureFrame({ contentDocument: null } as HTMLIFrameElement),
    ).toBeNull();
  });
});
