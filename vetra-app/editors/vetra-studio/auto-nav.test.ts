import { describe, expect, it } from "vitest";
import {
  IDEATION_TYPES,
  latestTouchedNavigable,
  sectionForDocumentType,
  type DocLike,
} from "./auto-nav.js";
import { SPECIFY_TYPES } from "./specify/projects.js";

function doc(
  id: string,
  documentType: string,
  lastModifiedAtUtcIso: string | Date,
  name = id,
): DocLike {
  return { header: { id, name, documentType, lastModifiedAtUtcIso } };
}

describe("sectionForDocumentType", () => {
  it("maps the five ideation sheet types to ideate", () => {
    expect([...IDEATION_TYPES].sort()).toEqual(
      [
        "powerhouse/audience-sheet",
        "powerhouse/brand-sheet",
        "powerhouse/feature",
        "powerhouse/problem-sheet",
        "powerhouse/work-breakdown-structure",
      ].sort(),
    );
    for (const type of IDEATION_TYPES) {
      expect(sectionForDocumentType(type)).toBe("ideate");
    }
  });

  it("maps all five builder spec types to specify", () => {
    expect([...SPECIFY_TYPES.keys()].sort()).toEqual(
      [
        "powerhouse/app",
        "powerhouse/document-editor",
        "powerhouse/document-model",
        "powerhouse/processor",
        "powerhouse/subgraph",
      ].sort(),
    );
    for (const type of SPECIFY_TYPES.keys()) {
      expect(sectionForDocumentType(type)).toBe("specify");
    }
  });

  it("maps everything else to null", () => {
    expect(sectionForDocumentType("powerhouse/chat-session")).toBeNull();
    expect(sectionForDocumentType("custom/task")).toBeNull();
  });
});

describe("latestTouchedNavigable", () => {
  it("returns null for an empty drive", () => {
    expect(latestTouchedNavigable([])).toBeNull();
  });

  it("returns null when no navigable docs exist", () => {
    const docs = [
      doc("a", "powerhouse/chat-session", "2026-06-04T10:00:00.000Z"),
      doc("b", "custom/task", "2026-06-04T11:00:00.000Z"),
    ];
    expect(latestTouchedNavigable(docs)).toBeNull();
  });

  it("picks the most recently modified navigable doc", () => {
    const docs = [
      doc("a", "powerhouse/brand-sheet", "2026-06-04T10:00:00.000Z", "Brand"),
      doc("b", "powerhouse/problem-sheet", "2026-06-04T12:00:00.000Z", "Prob"),
      doc("c", "powerhouse/audience-sheet", "2026-06-04T11:00:00.000Z", "Aud"),
    ];
    expect(latestTouchedNavigable(docs)).toEqual({
      id: "b",
      documentType: "powerhouse/problem-sheet",
      name: "Prob",
      ts: new Date("2026-06-04T12:00:00.000Z").getTime(),
      section: "ideate",
    });
  });

  it("follows a document-model and reports section specify", () => {
    const docs = [
      doc("a", "powerhouse/brand-sheet", "2026-06-04T10:00:00.000Z", "Brand"),
      doc("m", "powerhouse/document-model", "2026-06-04T23:00:00.000Z", "Task"),
    ];
    expect(latestTouchedNavigable(docs)).toEqual({
      id: "m",
      documentType: "powerhouse/document-model",
      name: "Task",
      ts: new Date("2026-06-04T23:00:00.000Z").getTime(),
      section: "specify",
    });
  });

  it("follows a document-editor and reports section specify", () => {
    const docs = [
      doc("a", "powerhouse/brand-sheet", "2026-06-04T10:00:00.000Z", "Brand"),
      doc(
        "e",
        "powerhouse/document-editor",
        "2026-06-04T23:00:00.000Z",
        "MyEditor",
      ),
    ];
    expect(latestTouchedNavigable(docs)).toEqual({
      id: "e",
      documentType: "powerhouse/document-editor",
      name: "MyEditor",
      ts: new Date("2026-06-04T23:00:00.000Z").getTime(),
      section: "specify",
    });
  });

  it("ignores non-navigable docs even if newer", () => {
    const docs = [
      doc("a", "powerhouse/brand-sheet", "2026-06-04T10:00:00.000Z", "Brand"),
      doc("z", "powerhouse/chat-session", "2026-06-04T23:00:00.000Z"), // newest but not navigable
    ];
    expect(latestTouchedNavigable(docs)?.id).toBe("a");
  });

  it("accepts Date instances as well as ISO strings", () => {
    const docs = [
      doc("a", "powerhouse/feature", new Date("2026-06-04T10:00:00.000Z")),
      doc("b", "powerhouse/feature", new Date("2026-06-04T13:00:00.000Z"), "B"),
    ];
    expect(latestTouchedNavigable(docs)?.id).toBe("b");
  });

  it("on equal timestamps prefers the later entry (newest appended)", () => {
    const t = "2026-06-04T10:00:00.000Z";
    const docs = [
      doc("a", "powerhouse/brand-sheet", t),
      doc("b", "powerhouse/problem-sheet", t),
    ];
    expect(latestTouchedNavigable(docs)?.id).toBe("b");
  });

  it("skips docs with an unparseable timestamp", () => {
    const docs = [
      doc("a", "powerhouse/brand-sheet", "2026-06-04T10:00:00.000Z", "Brand"),
      doc("bad", "powerhouse/feature", "not-a-date"),
    ];
    expect(latestTouchedNavigable(docs)?.id).toBe("a");
  });
});
