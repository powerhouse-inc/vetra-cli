import type { StudioProductDocument } from "document-models/studio-product/v1";
import {
  acceptSourceNotice,
  isStudioProductDocument,
  keepVariant,
  setNotesEnabled,
  setOrigin,
  setPublicSource,
  setReviewSuggestions,
  setSuggestions,
  setUpstreamVersion,
  setVariantStatus,
  startVariants,
  useSuggestion,
} from "document-models/studio-product/v1";
import { describe, expect, it } from "vitest";
import {
  apply,
  at,
  building,
  change,
  craftedChange,
  errorAt,
  liveVersion,
  withState,
} from "./helpers.js";

/** A product with version 1 live. */
function live(): StudioProductDocument {
  return withState({ versions: [liveVersion(1)], liveVersion: 1 });
}

const REMIX = {
  packageName: "@powerhousedao/knowledge-note",
  version: "1.2.0",
  mode: "REMIX" as const,
  license: "AGPL-3.0",
  sourceUrl: "https://github.com/apeiron-M/bai-knowledge-note",
  sourceRef: "v1.2.0",
  missing: ["editor tests"],
  at: at(2),
};

describe("SET_REVIEW_SUGGESTIONS", () => {
  it("stores review findings with screenshots and keeps ideas of the same version", () => {
    const doc = apply(
      live(),
      setSuggestions({
        afterVersion: 1,
        items: [
          { id: "i1", text: "Add tags" },
          { id: "i2", text: "Add a chart" },
        ],
      }),
      setReviewSuggestions({
        afterVersion: 1,
        items: [
          { id: "r1", text: " Empty list has no hint ", screenshot: "att:1" },
          { id: "r2", text: "Label is cut off on phones" },
        ],
      }),
      useSuggestion({ id: "r2" }),
      // A new pass replaces the open findings; ideas and used findings stay.
      setReviewSuggestions({
        afterVersion: 1,
        items: [{ id: "r3", text: "Contrast is low", screenshot: null }],
      }),
    );
    expect(isStudioProductDocument(doc)).toBe(true);
    expect(doc.operations.global.map((o) => o.error ?? null)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(doc.state.global.suggestions).toEqual([
      {
        id: "i1",
        text: "Add tags",
        afterVersion: 1,
        status: "OPEN",
        kind: "IDEA",
        screenshot: null,
      },
      {
        id: "i2",
        text: "Add a chart",
        afterVersion: 1,
        status: "OPEN",
        kind: "IDEA",
        screenshot: null,
      },
      {
        id: "r2",
        text: "Label is cut off on phones",
        afterVersion: 1,
        status: "USED",
        kind: "REVIEW",
        screenshot: null,
      },
      {
        id: "r3",
        text: "Contrast is low",
        afterVersion: 1,
        status: "OPEN",
        kind: "REVIEW",
        screenshot: null,
      },
    ]);
  });

  it("an empty set clears the open findings of that version", () => {
    const doc = apply(
      live(),
      setReviewSuggestions({
        afterVersion: 1,
        items: [{ id: "r1", text: "Empty list has no hint" }],
      }),
      setReviewSuggestions({ afterVersion: 1, items: [] }),
    );
    expect(errorAt(doc, 1)).toBeNull();
    expect(doc.state.global.suggestions).toEqual([]);
  });

  it("refuses more than 3 findings (INVALID_REVIEW_COUNT)", () => {
    const before = live();
    const doc = apply(
      before,
      setReviewSuggestions({
        afterVersion: 1,
        items: ["a", "b", "c", "d"].map((id) => ({
          id,
          text: `finding ${id}`,
        })),
      }),
    );
    expect(errorAt(doc, 0)).toBe("Give 0 to 3 review findings, not 4.");
    expect(doc.state.global.suggestions).toEqual([]);
  });

  it.each([
    ["empty", "   "],
    ["too long", "x".repeat(81)],
  ])("refuses a finding whose text is %s (INVALID_REVIEW_TEXT)", (_, text) => {
    const doc = apply(
      live(),
      setReviewSuggestions({ afterVersion: 1, items: [{ id: "r1", text }] }),
    );
    expect(errorAt(doc, 0)).toBe(
      "A review finding is 1 to 80 characters long.",
    );
    expect(doc.state.global.suggestions).toEqual([]);
  });

  it("refuses a duplicate id (DUPLICATE_REVIEW_ID)", () => {
    const doc = apply(
      live(),
      setSuggestions({
        afterVersion: 1,
        items: [
          { id: "i1", text: "Add tags" },
          { id: "i2", text: "Add a chart" },
        ],
      }),
      setReviewSuggestions({
        afterVersion: 1,
        items: [{ id: "i1", text: "Contrast is low" }],
      }),
    );
    expect(errorAt(doc, 1)).toBe('A suggestion "i1" already exists.');
    expect(doc.state.global.suggestions.map((s) => s.id)).toEqual(["i1", "i2"]);
  });

  it("refuses a version that does not exist (UNKNOWN_VERSION)", () => {
    const doc = apply(
      live(),
      setReviewSuggestions({
        afterVersion: 2,
        items: [{ id: "r1", text: "Contrast is low" }],
      }),
    );
    expect(errorAt(doc, 0)).toBe("No version 2 exists.");
    expect(doc.state.global.suggestions).toEqual([]);
  });
});

describe("variants", () => {
  it("START_VARIANTS adds A and B as BUILDING", () => {
    const doc = apply(
      building(),
      startVariants({ changeId: "c1", branchA: "var/a", branchB: "var/b" }),
    );
    expect(errorAt(doc, 3)).toBeNull();
    expect(change(doc).variants).toEqual([
      {
        label: "A",
        branch: "var/a",
        status: "BUILDING",
        chatSessionId: null,
        summary: null,
      },
      {
        label: "B",
        branch: "var/b",
        status: "BUILDING",
        chatSessionId: null,
        summary: null,
      },
    ]);
  });

  it("START_VARIANTS refuses an unknown change (VARIANT_CHANGE_NOT_FOUND)", () => {
    const doc = apply(
      building(),
      startVariants({ changeId: "nope", branchA: "a", branchB: "b" }),
    );
    expect(errorAt(doc, 3)).toBe('No change "nope" exists.');
  });

  it("START_VARIANTS refuses a change that is not building or ready (CHANGE_NOT_OPEN)", () => {
    const doc = apply(
      withState({ changes: [craftedChange("c9", "PAUSED")] }),
      startVariants({ changeId: "c9", branchA: "a", branchB: "b" }),
    );
    expect(errorAt(doc, 0)).toBe(
      'Change "c9" is PAUSED; variants start while it is building or ready.',
    );
    expect(change(doc, "c9").variants).toEqual([]);
  });

  it("START_VARIANTS refuses while variants exist (VARIANTS_EXIST) but allows a restart after both are discarded", () => {
    const discarded = {
      branch: "old",
      chatSessionId: null,
      summary: null,
      status: "DISCARDED" as const,
    };
    const doc = apply(
      withState({
        changes: [
          craftedChange("c1", "READY", {
            variants: [
              { ...discarded, label: "A" },
              { ...discarded, label: "B", status: "KEPT" },
            ],
          }),
          craftedChange("c2", "READY", {
            variants: [
              { ...discarded, label: "A" },
              { ...discarded, label: "B" },
            ],
          }),
        ],
      }),
      startVariants({ changeId: "c1", branchA: "a", branchB: "b" }),
      startVariants({ changeId: "c2", branchA: "a2", branchB: "b2" }),
    );
    expect(errorAt(doc, 0)).toBe('Change "c1" already has variants.');
    expect(change(doc, "c1").variants.map((v) => v.branch)).toEqual([
      "old",
      "old",
    ]);
    expect(errorAt(doc, 1)).toBeNull();
    expect(change(doc, "c2").variants.map((v) => v.branch)).toEqual([
      "a2",
      "b2",
    ]);
  });

  it("SET_VARIANT_STATUS moves BUILDING to READY or FAILED with session and summary", () => {
    const doc = apply(
      building(),
      startVariants({ changeId: "c1", branchA: "a", branchB: "b" }),
      setVariantStatus({
        changeId: "c1",
        label: "A",
        status: "READY",
        chatSessionId: "phd:session-a",
        summary: "Tags as chips",
      }),
      setVariantStatus({ changeId: "c1", label: "B", status: "FAILED" }),
    );
    expect(errorAt(doc, 4)).toBeNull();
    expect(errorAt(doc, 5)).toBeNull();
    expect(change(doc).variants).toEqual([
      {
        label: "A",
        branch: "a",
        status: "READY",
        chatSessionId: "phd:session-a",
        summary: "Tags as chips",
      },
      {
        label: "B",
        branch: "b",
        status: "FAILED",
        chatSessionId: null,
        summary: null,
      },
    ]);
  });

  it("SET_VARIANT_STATUS refuses an unknown change, a missing variant and invalid transitions", () => {
    const doc = apply(
      building(),
      setVariantStatus({ changeId: "nope", label: "A", status: "READY" }),
      setVariantStatus({ changeId: "c1", label: "A", status: "READY" }),
      startVariants({ changeId: "c1", branchA: "a", branchB: "b" }),
      setVariantStatus({ changeId: "c1", label: "A", status: "KEPT" }),
      setVariantStatus({ changeId: "c1", label: "B", status: "READY" }),
      setVariantStatus({ changeId: "c1", label: "B", status: "FAILED" }),
    );
    expect(errorAt(doc, 3)).toBe('No change "nope" exists.');
    expect(errorAt(doc, 4)).toBe('Change "c1" has no variant A.');
    expect(errorAt(doc, 6)).toBe("Variant A can't go from BUILDING to KEPT.");
    expect(errorAt(doc, 7)).toBeNull();
    expect(errorAt(doc, 8)).toBe("Variant B can't go from READY to FAILED.");
    expect(change(doc).variants.map((v) => v.status)).toEqual([
      "BUILDING",
      "READY",
    ]);
  });

  it("KEEP_VARIANT keeps the ready one and discards the other", () => {
    const doc = apply(
      building(),
      startVariants({ changeId: "c1", branchA: "a", branchB: "b" }),
      setVariantStatus({ changeId: "c1", label: "B", status: "READY" }),
      keepVariant({ changeId: "c1", label: "B" }),
    );
    expect(errorAt(doc, 5)).toBeNull();
    expect(change(doc).variants.map((v) => [v.label, v.status])).toEqual([
      ["A", "DISCARDED"],
      ["B", "KEPT"],
    ]);
  });

  it("KEEP_VARIANT refuses an unknown change, a missing variant and one that is not ready", () => {
    const doc = apply(
      building(),
      keepVariant({ changeId: "nope", label: "A" }),
      keepVariant({ changeId: "c1", label: "A" }),
      startVariants({ changeId: "c1", branchA: "a", branchB: "b" }),
      keepVariant({ changeId: "c1", label: "A" }),
    );
    expect(errorAt(doc, 3)).toBe('No change "nope" exists.');
    expect(errorAt(doc, 4)).toBe('Change "c1" has no variant A.');
    expect(errorAt(doc, 6)).toBe(
      "Variant A is BUILDING; only a ready one can be kept.",
    );
    expect(change(doc).variants.map((v) => v.status)).toEqual([
      "BUILDING",
      "BUILDING",
    ]);
  });
});

describe("origins", () => {
  it("SET_ORIGIN records an origin and upserts it by package name", () => {
    const doc = apply(
      withState({}),
      setOrigin(REMIX),
      setOrigin({
        packageName: "@acme/other",
        version: "0.1.0",
        mode: "COMPOSE",
        license: "MIT",
        missing: [],
        at: at(3),
      }),
      setUpstreamVersion({
        packageName: REMIX.packageName,
        latestVersion: "1.3.0",
        checkedAt: at(4),
      }),
      // Bringing in 1.3.0 re-records the origin; the last check is kept.
      setOrigin({ ...REMIX, version: "1.3.0", sourceRef: null, at: at(5) }),
    );
    expect(doc.operations.global.every((o) => !o.error)).toBe(true);
    expect(doc.state.global.origins).toEqual([
      {
        packageName: REMIX.packageName,
        version: "1.3.0",
        mode: "REMIX",
        license: "AGPL-3.0",
        sourceUrl: REMIX.sourceUrl,
        sourceRef: null,
        at: at(5),
        missing: ["editor tests"],
        latestVersion: "1.3.0",
        checkedAt: at(4),
      },
      {
        packageName: "@acme/other",
        version: "0.1.0",
        mode: "COMPOSE",
        license: "MIT",
        sourceUrl: null,
        sourceRef: null,
        at: at(3),
        missing: [],
        latestVersion: null,
        checkedAt: null,
      },
    ]);
  });

  it.each([
    ["name", { ...REMIX, packageName: " " }],
    ["version", { ...REMIX, version: "" }],
  ])("SET_ORIGIN refuses an empty %s (INVALID_ORIGIN)", (_, input) => {
    const doc = apply(withState({}), setOrigin(input));
    expect(errorAt(doc, 0)).toBe(
      "An origin needs a package name and a version.",
    );
    expect(doc.state.global.origins).toEqual([]);
  });

  it("SET_UPSTREAM_VERSION refuses an unknown package (ORIGIN_NOT_FOUND)", () => {
    const doc = apply(
      withState({}),
      setUpstreamVersion({
        packageName: "@acme/none",
        latestVersion: "2.0.0",
        checkedAt: at(1),
      }),
    );
    expect(errorAt(doc, 0)).toBe('No origin "@acme/none" exists.');
  });
});

describe("notes, source notice and public source", () => {
  it("SET_NOTES_ENABLED sets since when enabling, keeps it when already on, clears it when disabling", () => {
    let doc = apply(
      withState({}),
      setNotesEnabled({ enabled: true, at: at(1) }),
    );
    expect(doc.state.global.notes).toEqual({ enabled: true, since: at(1) });
    doc = apply(doc, setNotesEnabled({ enabled: true, at: at(2) }));
    expect(doc.state.global.notes).toEqual({ enabled: true, since: at(1) });
    doc = apply(doc, setNotesEnabled({ enabled: false, at: at(3) }));
    expect(doc.state.global.notes).toEqual({ enabled: false, since: null });
    expect(doc.operations.global.every((o) => !o.error)).toBe(true);
  });

  it("ACCEPT_SOURCE_NOTICE records when the notice was accepted", () => {
    const doc = apply(withState({}), acceptSourceNotice({ at: at(7) }));
    expect(errorAt(doc, 0)).toBeNull();
    expect(doc.state.global.sourceNoticeAcceptedAt).toBe(at(7));
  });

  it("SET_PUBLIC_SOURCE records where the source is published", () => {
    const doc = apply(
      withState({}),
      setPublicSource({
        kind: "GITHUB",
        url: "https://github.com/acme/dog-walks",
        version: 3,
      }),
    );
    expect(errorAt(doc, 0)).toBeNull();
    expect(doc.state.global.publicSource).toEqual({
      kind: "GITHUB",
      url: "https://github.com/acme/dog-walks",
      version: 3,
    });
  });

  it("SET_PUBLIC_SOURCE refuses a version below 1 (INVALID_PUBLIC_SOURCE)", () => {
    const doc = apply(
      withState({}),
      setPublicSource({
        kind: "PACKAGE",
        url: "https://registry.example/acme",
        version: 0,
      }),
    );
    expect(errorAt(doc, 0)).toBe(
      "A public source version is 1 or more, not 0.",
    );
    expect(doc.state.global.publicSource).toBeNull();
  });
});
