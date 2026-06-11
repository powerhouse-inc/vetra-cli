import { describe, expect, it } from "vitest";
import { missingDocumentIds } from "./useDriveDocuments.js";

function doc(id: string): { header: { id: string } } {
  return { header: { id } };
}

describe("missingDocumentIds", () => {
  it("returns empty for an empty node list", () => {
    expect(missingDocumentIds([], [doc("a")])).toEqual([]);
  });

  it("returns empty when every node has a resolved document", () => {
    expect(missingDocumentIds(["a", "b"], [doc("a"), doc("b")])).toEqual([]);
  });

  it("returns ids whose documents are missing from the batch", () => {
    expect(missingDocumentIds(["a", "b", "c"], [doc("b")])).toEqual(["a", "c"]);
  });

  it("returns all ids when no documents resolved", () => {
    expect(missingDocumentIds(["a", "b"], [])).toEqual(["a", "b"]);
  });
});
