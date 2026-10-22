import { describe, expect, it, vi } from "vitest";
import {
  deliveryBackoff,
  deliverMessage,
  deliverOnce,
  type DeliveryState,
  type DeliverMessageOptions,
} from "./outbox.js";

/** No real timers in tests: the wait seam is a resolved promise. */
const noWait = () => Promise.resolve();

function options(
  overrides: Partial<DeliverMessageOptions> = {},
): DeliverMessageOptions {
  return {
    waitUntilReady: () => Promise.resolve(true),
    isDelivered: () => Promise.resolve(false),
    send: () => Promise.resolve(),
    wait: noWait,
    ...overrides,
  };
}

describe("deliverMessage", () => {
  it("holds the message until the runtime is ready, then sends it once", async () => {
    const ready = Promise.withResolvers<boolean>();
    const waiting = Promise.withResolvers<void>();
    const send = vi.fn(() => Promise.resolve());
    const states: DeliveryState[] = [];

    const delivery = deliverMessage(
      options({
        waitUntilReady: () => {
          waiting.resolve();
          return ready.promise;
        },
        send,
        onState: (s) => states.push(s),
      }),
    );
    await waiting.promise;
    expect(send).not.toHaveBeenCalled();
    expect(states).toEqual(["connecting"]);

    ready.resolve(true);
    await expect(delivery).resolves.toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["connecting", "sent"]);
  });

  it("does not send a message the session already has", async () => {
    const send = vi.fn(() => Promise.resolve());
    const waitUntilReady = vi.fn(() => Promise.resolve(true));

    const state = await deliverMessage(
      options({
        isDelivered: () => Promise.resolve(true),
        send,
        waitUntilReady,
      }),
    );

    expect(state).toBe("sent");
    expect(send).not.toHaveBeenCalled();
    expect(waitUntilReady).not.toHaveBeenCalled();
  });

  it("joins concurrent deliveries with the same key into one send", async () => {
    const send = vi.fn(() => Promise.resolve());
    const running = options({ send });

    const first = deliverOnce("session-1:message-1", running);
    const second = deliverOnce("session-1:message-1", running);

    expect(second).toBe(first);
    await expect(first).resolves.toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries a refused dispatch and fails only after the budget", async () => {
    const send = vi.fn(() => Promise.reject(new Error("offline")));
    const states: DeliveryState[] = [];

    const state = await deliverMessage(
      options({ send, attempts: 3, onState: (s) => states.push(s) }),
    );

    expect(state).toBe("failed");
    expect(send).toHaveBeenCalledTimes(3);
    expect(states).toEqual(["connecting", "failed"]);
  });

  it("sends once after a transient refusal", async () => {
    let calls = 0;
    const send = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("offline"))
        : Promise.resolve();
    });

    await expect(deliverMessage(options({ send, attempts: 3 }))).resolves.toBe(
      "sent",
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not resend a dispatch that landed before it reported an error", async () => {
    let stored = false;
    const send = vi.fn(() => {
      stored = true;
      return Promise.reject(new Error("ack lost"));
    });

    const state = await deliverMessage(
      options({
        isDelivered: () => Promise.resolve(stored),
        send,
        attempts: 3,
      }),
    );

    expect(state).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the runtime never becomes ready", async () => {
    const send = vi.fn(() => Promise.resolve());

    const state = await deliverMessage(
      options({ waitUntilReady: () => Promise.resolve(false), send }),
    );

    expect(state).toBe("failed");
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing after the delivery was cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn(() => Promise.resolve());

    const state = await deliverMessage(
      options({ send, signal: controller.signal }),
    );

    expect(state).toBe("failed");
    expect(send).not.toHaveBeenCalled();
  });

  it("backs off exponentially up to the cap", () => {
    expect(deliveryBackoff(0)).toBe(500);
    expect(deliveryBackoff(1)).toBe(1_000);
    expect(deliveryBackoff(2)).toBe(2_000);
    expect(deliveryBackoff(10)).toBe(4_000);
  });
});
