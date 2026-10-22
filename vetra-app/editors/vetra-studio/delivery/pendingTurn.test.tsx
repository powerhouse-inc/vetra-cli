// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { atSec, chat, user } from "../story/storyFixtures.js";
import type { StoryChat } from "../story/storyModel.js";
import { at } from "../test-utils/studioFixtures.js";
import { render, rerender } from "../test-utils/render.js";
import { pendingTurnOf, usePendingTurnRetry } from "./pendingTurn.js";

/** 90 s after the message: past the 60 s "not delivered" threshold. */
const LATE = new Date(atSec(2, 30));

/** The probe's `data-retrying` (the container itself holds no state). */
function retrying(container: HTMLElement): string | null {
  return (
    container.querySelector("[data-retrying]")?.getAttribute("data-retrying") ??
    null
  );
}

/** Lets the wait's promise and its state updates settle. */
async function settle() {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

function Probe({
  chat: c,
  onRetry,
  ready,
  enabled = true,
}: {
  chat: StoryChat;
  onRetry: (id: string) => void;
  ready?: () => Promise<boolean>;
  enabled?: boolean;
}) {
  const state = usePendingTurnRetry(c, LATE, onRetry, {
    enabled,
    ...(ready ? { waitUntilReady: ready } : {}),
  });
  return (
    <p
      data-pending={state.pending?.id ?? ""}
      data-retrying={String(state.retrying)}
    />
  );
}

describe("pendingTurnOf", () => {
  it("finds the message the agent hasn't picked up after 60 s", () => {
    const c = chat(user("u1", "add slides", at(1)));
    expect(pendingTurnOf(c, LATE)?.id).toBe("u1");
    expect(pendingTurnOf(c, new Date(atSec(1, 30)))).toBeNull();
    expect(
      pendingTurnOf(chat(user("u1", "add slides", at(1), at(2))), LATE),
    ).toBeNull();
    expect(pendingTurnOf(null, LATE)).toBeNull();
  });
});

describe("usePendingTurnRetry", () => {
  it("retries the turn once the runtime answers, once per message", async () => {
    const onRetry = vi.fn();
    const ready = () => Promise.resolve(true);
    const c = chat(user("u1", "add slides", at(1)));
    const container = render(
      <Probe chat={c} onRetry={onRetry} ready={ready} />,
    );
    await settle();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("u1");
    expect(retrying(container)).toBe("false");

    rerender(container, <Probe chat={c} onRetry={onRetry} ready={ready} />);
    await settle();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("waits for a restarting runtime, then retries", async () => {
    const onRetry = vi.fn();
    const gate = Promise.withResolvers<boolean>();
    const ready = () => gate.promise;
    const container = render(
      <Probe
        chat={chat(user("u1", "add slides", at(1)))}
        onRetry={onRetry}
        ready={ready}
      />,
    );
    expect(retrying(container)).toBe("true");
    expect(onRetry).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve(true);
      await gate.promise;
    });
    await settle();
    expect(onRetry).toHaveBeenCalledWith("u1");
    expect(retrying(container)).toBe("false");
  });

  it("gives up to the manual Retry when the runtime does not answer", async () => {
    const onRetry = vi.fn();
    const container = render(
      <Probe
        chat={chat(user("u1", "add slides", at(1)))}
        onRetry={onRetry}
        ready={() => Promise.resolve(false)}
      />,
    );
    await settle();
    expect(onRetry).not.toHaveBeenCalled();
    expect(retrying(container)).toBe("false");
  });

  it("does nothing when turned off", async () => {
    const onRetry = vi.fn();
    const ready = vi.fn(() => Promise.resolve(true));
    const container = render(
      <Probe
        chat={chat(user("u1", "add slides", at(1)))}
        onRetry={onRetry}
        ready={ready}
        enabled={false}
      />,
    );
    await settle();
    expect(ready).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
    expect(retrying(container)).toBe("false");
  });
});
