import {
  initProduct,
  placeholderName,
  renameProduct,
  setAccess,
  utils,
} from "document-models/studio-product/v1";
import { describe, expect, it } from "vitest";
import { apply, at, errorAt } from "./helpers.js";

describe("product module", () => {
  it("starts empty with the documented defaults", () => {
    const state = utils.createDocument().state.global;
    expect(state).toMatchObject({
      name: null,
      idea: null,
      createdAt: null,
      access: "SIGNED_IN",
      changes: [],
      activeChangeId: null,
      liveVersion: null,
      versions: [],
      health: "UNKNOWN",
      pendingRequest: null,
      launchPermission: "UNKNOWN",
      suggestions: [],
      github: { status: "NOT_CONNECTED", repoFullName: null },
    });
  });

  it("INIT_PRODUCT stores name, idea and createdAt", () => {
    const doc = apply(
      utils.createDocument(),
      initProduct({
        name: "Dog walks",
        idea: "plan dog walks",
        createdAt: at(0),
      }),
    );
    expect(errorAt(doc, 0)).toBeNull();
    expect(doc.state.global.name).toBe("Dog walks");
    expect(doc.state.global.idea).toBe("plan dog walks");
    expect(doc.state.global.createdAt).toBe(at(0));
  });

  it("INIT_PRODUCT twice is rejected", () => {
    const doc = apply(
      utils.createDocument(),
      initProduct({ name: "First", idea: "first idea", createdAt: at(0) }),
      initProduct({ name: "Second", idea: "second idea", createdAt: at(1) }),
    );
    expect(errorAt(doc, 1)).toMatch(/already initialised/);
    expect(doc.state.global.name).toBe("First");
    expect(doc.state.global.createdAt).toBe(at(0));
  });

  it("RENAME_PRODUCT and SET_ACCESS update the product", () => {
    const doc = apply(
      utils.createDocument(),
      initProduct({
        name: "Dog walks",
        idea: "plan dog walks",
        createdAt: at(0),
      }),
      renameProduct({ name: "Walkies" }),
      setAccess({ access: "OWNER_ONLY" }),
    );
    expect(doc.state.global.name).toBe("Walkies");
    expect(doc.state.global.access).toBe("OWNER_ONLY");
  });
});

describe("placeholderName", () => {
  it("takes the first four words and capitalises the first letter", () => {
    expect(placeholderName("an app to plan dog walks with friends")).toBe(
      "An app to plan",
    );
  });

  it("keeps short ideas whole and collapses whitespace", () => {
    expect(placeholderName("  todo   list ")).toBe("Todo list");
  });

  it("returns an empty string for an empty idea", () => {
    expect(placeholderName("   ")).toBe("");
  });
});
