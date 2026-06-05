import { describe, expect, it } from "vitest";
import {
  isNavigableFile,
  navigableIds,
  pickNewlyCreatedTarget,
  type DriveNodeLike,
} from "./auto-nav.js";

function file(id: string, documentType: string, name = id): DriveNodeLike {
  return { id, kind: "file", documentType, name };
}

const folder: DriveNodeLike = { id: "fold", kind: "folder", name: "Folder" };

describe("isNavigableFile", () => {
  it("accepts the five ideation sheet types", () => {
    expect(isNavigableFile(file("a", "powerhouse/brand-sheet"))).toBe(true);
    expect(isNavigableFile(file("a", "powerhouse/problem-sheet"))).toBe(true);
    expect(isNavigableFile(file("a", "powerhouse/audience-sheet"))).toBe(true);
    expect(isNavigableFile(file("a", "powerhouse/feature"))).toBe(true);
    expect(
      isNavigableFile(file("a", "powerhouse/work-breakdown-structure")),
    ).toBe(true);
  });

  it("rejects folders, non-ideation types, and missing documentType", () => {
    expect(isNavigableFile(folder)).toBe(false);
    expect(isNavigableFile(file("a", "powerhouse/document-model"))).toBe(false);
    expect(isNavigableFile(file("a", "powerhouse/app"))).toBe(false);
    expect(isNavigableFile({ id: "x", kind: "file", name: "x" })).toBe(false);
  });
});

describe("navigableIds", () => {
  it("collects only navigable file ids", () => {
    const ids = navigableIds([
      file("a", "powerhouse/brand-sheet"),
      file("b", "powerhouse/document-model"), // not navigable
      folder,
      file("c", "powerhouse/feature"),
    ]);
    expect([...ids].sort()).toEqual(["a", "c"]);
  });
});

describe("pickNewlyCreatedTarget", () => {
  it("returns null when nothing navigable was added", () => {
    const nodes = [file("a", "powerhouse/brand-sheet")];
    expect(pickNewlyCreatedTarget(new Set(["a"]), nodes)).toBeNull();
  });

  it("returns the new navigable node as an OpenTarget", () => {
    const nodes = [
      file("a", "powerhouse/brand-sheet"),
      file("b", "powerhouse/problem-sheet", "Problem"),
    ];
    expect(pickNewlyCreatedTarget(new Set(["a"]), nodes)).toEqual({
      id: "b",
      documentType: "powerhouse/problem-sheet",
      name: "Problem",
    });
  });

  it("ignores newly added non-navigable types", () => {
    const nodes = [
      file("a", "powerhouse/brand-sheet"),
      file("b", "powerhouse/document-model"), // new but not navigable
      folder,
    ];
    expect(pickNewlyCreatedTarget(new Set(["a"]), nodes)).toBeNull();
  });

  it("returns the newest (last) when multiple are added", () => {
    const nodes = [
      file("a", "powerhouse/brand-sheet"),
      file("b", "powerhouse/problem-sheet"),
      file("c", "powerhouse/audience-sheet", "Audience"),
    ];
    // a is known; b and c are new → c (last) wins
    expect(pickNewlyCreatedTarget(new Set(["a"]), nodes)).toEqual({
      id: "c",
      documentType: "powerhouse/audience-sheet",
      name: "Audience",
    });
  });

  it("seed case (everything already known) yields null", () => {
    const nodes = [
      file("a", "powerhouse/brand-sheet"),
      file("b", "powerhouse/feature"),
    ];
    expect(pickNewlyCreatedTarget(navigableIds(nodes), nodes)).toBeNull();
  });
});
