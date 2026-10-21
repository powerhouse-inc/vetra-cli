import { describe, expect, it } from "vitest";
import { at } from "../test-utils/studioFixtures.js";
import { copyAllText } from "./copyAll.js";
import { reply, toolCall, user } from "./storyFixtures.js";
import { toolResultsOf, type StoryLine } from "./storyModel.js";

describe("copyAllText", () => {
  it("includes every tool call and its result", () => {
    const call = toolCall("a1", "Write", { path: "src/A.tsx" }, at(2));
    const result = {
      ...user("t1", "", at(3)),
      role: "TOOL" as const,
      content: [
        {
          ...call.content[0],
          id: "t1-r",
          type: "TOOL_RESULT" as const,
          toolCallId: "a1-call",
          result: "wrote 12 lines",
        },
      ],
    };
    const lines: StoryLine[] = [
      { kind: "idea", id: "idea", at: at(1), text: "a board", detail: [] },
      {
        kind: "milestone",
        id: "m1",
        at: at(3),
        mark: "✓",
        text: "Planned",
        detail: [call, reply("a2", "All done.", at(3)), result],
        doingNow: null,
        outcome: null,
        summary: "",
      },
    ];
    const text = copyAllText(lines, toolResultsOf([call, result]));
    expect(text).toContain("a board");
    expect(text).toContain("Planned");
    expect(text).toContain("Write");
    expect(text).toContain('{"path":"src/A.tsx"}');
    expect(text).toContain("wrote 12 lines");
    expect(text).toContain("All done.");
  });
});
