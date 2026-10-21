import type { ProductStep } from "document-models/studio-product";
import { describe, expect, it } from "vitest";
import { SCREEN_DOCS, toolTurn } from "../test-utils/previewFixtures.js";
import {
  APP_SPEC_TYPE,
  previewScreens,
  previewTabs,
  screenLabel,
  screenPreviews,
  tabForTarget,
} from "./previewTabs.js";

function editorsStep(status: ProductStep["status"]): ProductStep {
  return {
    kind: "EDITORS",
    status,
    done: 2,
    total: 3,
    label: null,
    reason: null,
    updatedAt: null,
  };
}

describe("previewTabs", () => {
  const screens = previewScreens(SCREEN_DOCS);

  it("one tab per available editor and app, editors first, in plain words", () => {
    expect(screens.map((s) => s.id)).toEqual(["ed-order", "ed-menu", "app-1"]);
    // The draft app isn't available yet (no code, not being built).
    expect(previewTabs({ screens }).map((t) => t.label)).toEqual([
      "Order editor",
      "Menu editor",
    ]);
    expect(screenLabel({ kind: "editor", name: "" })).toBe("Editor");
  });

  it("tabs mark the in-progress editor as building", () => {
    const tabs = previewTabs({
      screens,
      editorsStep: editorsStep("WORKING"),
      activeScreenId: "ed-menu",
    });
    expect(tabs.filter((t) => t.building).map((t) => t.id)).toEqual([
      "ed-menu",
    ]);
    // Not told which: the first screen whose code isn't generated yet.
    const guess = previewTabs({
      screens,
      editorsStep: editorsStep("WORKING"),
    });
    expect(guess.filter((t) => t.building).map((t) => t.id)).toEqual(["app-1"]);
    // The screen being built gets its tab before its code exists.
    expect(guess.map((t) => t.label)).toEqual([
      "Order editor",
      "Menu editor",
      "Kitchen queue",
    ]);
  });

  it("nothing is building while the Editors step isn't working", () => {
    for (const step of [editorsStep("DONE"), editorsStep("NEEDS_YOU"), null]) {
      const tabs = previewTabs({
        screens,
        editorsStep: step,
        activeScreenId: "ed-menu",
      });
      expect(tabs.some((t) => t.building)).toBe(false);
    }
  });
});

describe("screenPreviews", () => {
  const screens = previewScreens(SCREEN_DOCS);

  it("finds each screen's preview and the screen the agent is on", () => {
    const messages = [
      toolTurn(
        "spec-preview-create",
        { project: "hotel", type: "hotel/order", name: "Breakfast for 2" },
        'Created hotel/order "Breakfast for 2"  id: doc-o1  (drive d1)',
      ),
      toolTurn(
        "spec-preview-create",
        { project: "hotel", type: "hotel/menu", name: "Menu" },
        "boom",
        true,
      ),
      toolTurn(
        "spec-preview-show",
        { project: "hotel", name: "Breakfast for 2" },
        { data: { documentId: "doc-o1", documentSlug: "breakfast-for-2" } },
      ),
      toolTurn(
        "spec-preview-show",
        { project: "hotel", drive: "drv-app", app: "kitchen-queue" },
        { data: { kind: "drive", driveId: "drv-app" } },
      ),
      toolTurn(
        "mastra_workspace_write_file",
        { path: "hotel/editors/menu-editor/editor.tsx" },
        "ok",
      ),
    ];
    const found = screenPreviews(messages, screens);
    expect(found.targets.get("ed-order")).toMatchObject({
      project: "hotel",
      doc: "breakfast-for-2",
    });
    expect(found.targets.get("app-1")).toMatchObject({
      project: "hotel",
      drive: "drv-app",
    });
    expect(found.targets.has("ed-menu")).toBe(false);
    // Writing the menu screen's files: the agent is on it now.
    expect(found.activeScreenId).toBe("ed-menu");
    expect(
      tabForTarget(found.targets, {
        project: "hotel",
        doc: "breakfast-for-2",
        callId: "x",
      }),
    ).toBe("ed-order");
    expect(tabForTarget(found.targets, undefined)).toBeNull();
  });

  it("an edited spec makes its screen the active one", () => {
    const messages = [
      toolTurn(
        "spec-update",
        { id: "app-1" },
        { data: { documentId: "app-1", documentType: APP_SPEC_TYPE } },
      ),
    ];
    expect(screenPreviews(messages, screens).activeScreenId).toBe("app-1");
  });
});
