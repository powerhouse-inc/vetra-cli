import { describe, expect, it, vi } from "vitest";
import { waitForChatReady } from "./chatReadiness.js";

describe("waitForChatReady", () => {
  it("returns at once when the runtime already answers", async () => {
    const probe = vi.fn(() => Promise.resolve(true));
    const wait = vi.fn(() => Promise.resolve());
    const now = 0;

    const ready = await waitForChatReady({
      probe,
      budgetMs: 5_000,
      now: () => now,
      wait,
    });

    expect(ready).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("polls the real probe until it answers, without a fixed sleep", async () => {
    const answers = [false, false, true];
    const probe = vi.fn(() => Promise.resolve(answers.shift() ?? true));
    const waits: number[] = [];
    let now = 0;

    const ready = await waitForChatReady({
      probe,
      budgetMs: 10_000,
      pollMs: 1_000,
      now: () => now,
      wait: (ms) => {
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });

    expect(ready).toBe(true);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1_000, 1_000]);
  });

  it("gives up only when the budget is spent", async () => {
    const probe = vi.fn(() => Promise.resolve(false));
    const waits: number[] = [];
    let now = 0;

    const ready = await waitForChatReady({
      probe,
      budgetMs: 2_500,
      pollMs: 1_000,
      now: () => now,
      wait: (ms) => {
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });

    expect(ready).toBe(false);
    expect(now).toBe(2_500);
    expect(waits).toEqual([1_000, 1_000, 500]);
  });

  it("treats a failing probe as not ready and keeps polling", async () => {
    let calls = 0;
    const probe = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("daemon down"))
        : Promise.resolve(true);
    });
    let now = 0;

    const ready = await waitForChatReady({
      probe,
      budgetMs: 5_000,
      now: () => now,
      wait: (ms) => {
        now += ms;
        return Promise.resolve();
      },
    });

    expect(ready).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("stops on an abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const probe = vi.fn(() => Promise.resolve(true));

    await expect(
      waitForChatReady({ probe, signal: controller.signal }),
    ).resolves.toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});
