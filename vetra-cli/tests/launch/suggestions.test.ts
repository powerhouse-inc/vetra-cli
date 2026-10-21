import { describe, expect, it } from "@jest/globals";
import { BUDGET_EXHAUSTED, budgetFailedLast, hasSuggestionsFor, versionChatSession } from "../../src/launch/suggestions.js";

const NOW = new Date("2026-10-21T09:00:00.000Z");
const failed = (code: string, failedAt = "2026-10-21T08:00:00.000Z") => ({ role: "ASSISTANT", failure: { code, failedAt } });

describe("after-launch suggestions helpers", () => {
  it("the budget counts as used up only when the latest turn failed on it recently", () => {
    expect(budgetFailedLast([], NOW)).toBe(false);
    expect(budgetFailedLast([{ role: "USER" }, failed(BUDGET_EXHAUSTED)], NOW)).toBe(true);
    expect(budgetFailedLast([failed(BUDGET_EXHAUSTED), { role: "USER" }], NOW)).toBe(true);
    expect(budgetFailedLast([failed("RATE_LIMITED")], NOW)).toBe(false);
    // Last month's failure, or one without a time, no longer counts.
    expect(budgetFailedLast([failed(BUDGET_EXHAUSTED, "2026-09-30T08:00:00.000Z")], NOW)).toBe(false);
    expect(budgetFailedLast([{ role: "ASSISTANT", failure: { code: BUDGET_EXHAUSTED } }], NOW)).toBe(false);
    // A later finished turn means the budget was raised since.
    expect(
      budgetFailedLast([failed(BUDGET_EXHAUSTED), { role: "ASSISTANT", finishedAt: "2026-10-21T08:30:00.000Z" }], NOW),
    ).toBe(false);
  });

  it("finds the launched change's latest conversation and existing suggestions", () => {
    const state = {
      suggestions: [{ id: "s1", text: "x", afterVersion: 2, status: "OPEN" }],
      versions: [
        { number: 1, changeId: "c1" },
        { number: 2, changeId: "c2" },
        { number: 3, changeId: null },
      ],
      changes: [
        { id: "c1", chatSessionId: "chat-a", chatSessionIds: ["chat-a", "chat-b"] },
        { id: "c2", chatSessionId: "chat-c", chatSessionIds: undefined },
      ],
    } as never;
    expect(versionChatSession(state, 1)).toBe("chat-b");
    expect(versionChatSession(state, 2)).toBe("chat-c");
    expect(versionChatSession(state, 3)).toBeNull();
    expect(versionChatSession(state, 4)).toBeNull();
    expect(hasSuggestionsFor(state, 2)).toBe(true);
    expect(hasSuggestionsFor(state, 1)).toBe(false);
    expect(hasSuggestionsFor({ suggestions: undefined } as never, 1)).toBe(false);
  });
});
