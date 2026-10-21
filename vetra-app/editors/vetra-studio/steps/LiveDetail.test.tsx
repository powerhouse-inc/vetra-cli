// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { render } from "../test-utils/render.js";
import { at, buildingOps, productDoc } from "../test-utils/studioFixtures.js";
import { LiveDetail } from "./LiveDetail.js";

function version(number: number, title: string, launchedAt: string) {
  return {
    number,
    title,
    summary: null,
    changeId: null,
    gitTag: `v${number}`,
    sha: "abc",
    packages: [],
    deploymentId: null,
    launchedAt,
    launchedBy: "you",
    trigger: "MANUAL",
    status: "PREVIOUS" as const,
    lines: [],
    changedFiles: [],
    failure: null,
    rollbackBlockedReason: null,
  };
}

describe("LiveDetail", () => {
  it("not live yet says it goes live by itself", () => {
    const product = readProduct(productDoc(...buildingOps()).state.global);
    const container = render(
      <LiveDetail product={product} now={new Date(at(10))} />,
    );
    expect(container.textContent).toContain("Not live yet");
    expect(container.textContent).toContain(
      "Your product goes live by itself once its checks pass.",
    );
    expectNoForbiddenWords(container);
  });

  it("live: address, last launch, versions and GitHub", () => {
    const product = readProduct(productDoc(...buildingOps()).state.global);
    product.liveVersion = 2;
    product.liveUrl = "https://task-board.vetra.io";
    product.github.status = "CONNECTED";
    product.versions = [
      version(1, "First version", at(1)),
      version(2, "Ready column", at(8)),
    ];
    const container = render(
      <LiveDetail product={product} now={new Date(at(10))} />,
    );
    const text = container.textContent;
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://task-board.vetra.io",
    );
    expect(text).toContain("task-board.vetra.io ↗");
    expect(text).toContain("Version 2 · Deployed 2 min ago");
    expect(text).toContain(
      "Keep a copy of your code in your own GitHub account. Every launch becomes a commit you can see.",
    );
    expect(text).toContain("GitHub ✓");
    expect(text).toContain("Version 2 — Ready column · Live");
    expect(text).toContain("Version 1 — First version");
    expectNoForbiddenWords(container);
  });
});
