import { describe, expect, it } from "vitest";
import {
  materialsReducer,
  readyCards,
  type MaterialItem,
} from "./materialList.js";

const card = { id: "m1", name: "a.csv", kind: "SHEET" as const };

describe("materialsReducer", () => {
  it("walks a file from uploading to ready and removes it", () => {
    let s: MaterialItem[] = [];
    s = materialsReducer(s, { type: "uploading", key: "k1", name: "a.csv" });
    expect(s[0]?.status).toBe("uploading");
    s = materialsReducer(s, { type: "added", key: "k1", card });
    expect(s[0]).toMatchObject({ status: "ready", card });
    expect(readyCards(s)).toEqual([card]);
    s = materialsReducer(s, { type: "remove", key: "k1" });
    expect(s).toEqual([]);
  });

  it("marks one file failed and keeps the others", () => {
    let s: MaterialItem[] = [];
    s = materialsReducer(s, { type: "uploading", key: "k1", name: "a" });
    s = materialsReducer(s, { type: "uploading", key: "k2", name: "b" });
    s = materialsReducer(s, { type: "added", key: "k2", card });
    s = materialsReducer(s, { type: "failed", key: "k1", error: "too-large" });
    expect(s[0]).toMatchObject({ status: "failed", error: "too-large" });
    expect(readyCards(s)).toEqual([card]);
  });
});
