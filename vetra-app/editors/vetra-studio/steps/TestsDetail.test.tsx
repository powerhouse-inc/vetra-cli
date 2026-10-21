// @vitest-environment happy-dom
import { actions } from "document-models/studio-product";
import { describe, expect, it } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { render } from "../test-utils/render.js";
import { at, buildingOps, productDoc } from "../test-utils/studioFixtures.js";
import { TestsDetail } from "./TestsDetail.js";

describe("TestsDetail", () => {
  it("lists each check passing or failing with a plain reason", () => {
    const doc = productDoc(
      ...buildingOps(),
      actions.recordCheckRun({
        changeId: "c1",
        id: "r1",
        at: at(5),
        results: [
          { kind: "TYPECHECK", passed: true },
          {
            kind: "REDUCER_TESTS",
            passed: false,
            reason: "Adding a task with no title is accepted",
          },
        ],
      }),
    );
    const container = render(
      <TestsDetail change={readProduct(doc.state.global).changes[0]} />,
    );
    const rows = Array.from(container.querySelectorAll("li")).map(
      (li) => li.textContent,
    );
    expect(rows).toEqual([
      "○Code generated from the data modelsnot run yet",
      "✓Type checkpassed",
      "○Lintnot run yet",
      "✕Reducer testsfailedAdding a task with no title is accepted",
      "○Preview renders without errorsnot run yet",
    ]);
    expectNoForbiddenWords(container);
  });
});
