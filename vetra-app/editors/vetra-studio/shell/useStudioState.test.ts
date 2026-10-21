import { actions } from "document-models/studio-product";
import { describe, expect, it } from "vitest";
import {
  PRODUCT_ID,
  SESSION_ID,
  at,
  buildingOps,
  chatDoc,
  drive,
  file,
  productDoc,
} from "../test-utils/studioFixtures.js";
import {
  findProductDocument,
  readProduct,
  studioState,
} from "./useStudioState.js";

const PRODUCT = file(PRODUCT_ID, "vetra/studio-product");
const SESSION = file(SESSION_ID, "powerhouse/chat-session");

describe("studioState", () => {
  it("idea state when the drive has no product", () => {
    expect(studioState(null, drive([]), [])).toBe("idea");
    // An unused conversation alone doesn't make an older Studio.
    expect(studioState(null, drive([SESSION]), [chatDoc(SESSION_ID, 0)])).toBe(
      "idea",
    );
  });

  it("an old Studio without a product document opens the old view", () => {
    expect(studioState(null, drive([SESSION]), [chatDoc(SESSION_ID, 2)])).toBe(
      "legacy",
    );
    expect(
      studioState(
        null,
        drive([file("model-1", "powerhouse/document-model")]),
        [],
      ),
    ).toBe("legacy");
  });

  it("idea state while the product has no change or its first message isn't sent", () => {
    const initialised = productDoc(buildingOps()[0]);
    expect(
      studioState(readProduct(initialised.state.global), drive([PRODUCT]), [
        initialised,
      ]),
    ).toBe("idea");

    // Change started, but the idea never reached the conversation: resume.
    const started = productDoc(...buildingOps());
    expect(
      studioState(
        readProduct(started.state.global),
        drive([PRODUCT, SESSION]),
        [started, chatDoc(SESSION_ID, 0)],
      ),
    ).toBe("idea");
  });

  it("building once the first message is in, live once a version is live", () => {
    const doc = productDoc(...buildingOps());
    const nodes = drive([PRODUCT, SESSION]);
    const documents = [doc, chatDoc(SESSION_ID, 1)];
    const product = readProduct(doc.state.global);
    expect(studioState(product, nodes, documents)).toBe("building");

    product.liveVersion = 1;
    expect(studioState(product, nodes, documents)).toBe("live");
  });

  it("a product whose document isn't loaded yet counts as building", () => {
    expect(studioState(null, drive([PRODUCT]), [])).toBe("building");
  });

  it("finds the product document and reads a normalised copy", () => {
    const doc = productDoc(
      ...buildingOps(),
      actions.startStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
    );
    const nodes = drive([PRODUCT, SESSION]);
    expect(findProductDocument(nodes, [chatDoc(SESSION_ID, 1), doc])).toBe(doc);
    expect(findProductDocument(drive([]), [doc])).toBeUndefined();

    const before = JSON.stringify(doc.state.global);
    const copy = readProduct(doc.state.global);
    copy.changes[0].steps[0].status = "DONE";
    expect(JSON.stringify(doc.state.global)).toBe(before);
  });
});
