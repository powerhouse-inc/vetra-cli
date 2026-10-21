import { describe, expect, it } from "vitest";
import { attentionItems } from "./attention.js";
import type { StoryLine } from "../story/storyModel.js";

const at = "2026-01-01T00:00:00Z";

describe("attentionItems", () => {
  it("lists questions, stuck and needs-you lines and the failure", () => {
    const lines: StoryLine[] = [
      { kind: "paused", id: "p", at },
      { kind: "reply", id: "r1", at, text: "Due dates?", question: true },
      { kind: "reply", id: "r2", at, text: "Done.", question: false },
      { kind: "stuck", id: "s1", at, reason: "Stuck here", tried: [] },
      { kind: "attention", id: "a1", at, step: "DATA", text: "Needs you" },
    ];
    expect(
      attentionItems(lines, { situation: "restarting", text: "Restarting" }),
    ).toEqual([
      { id: "r1", text: "Due dates?" },
      { id: "s1", text: "Stuck here" },
      { id: "a1", text: "Needs you" },
      { id: "failure:restarting:", text: "Restarting" },
    ]);
  });

  it("is empty when nothing waits", () => {
    expect(attentionItems([], null)).toEqual([]);
  });
});
