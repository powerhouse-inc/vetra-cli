/**
 * Delivers one chat message without losing it to a restarting chat runtime.
 *
 * The order is what keeps a message from being lost or doubled:
 *   1. if the session document already has the message id, it is delivered —
 *      a retry or a second caller never sends it again;
 *   2. otherwise wait for the real readiness signal (the daemon's `/healthz`);
 *   3. send once it is ready, retrying only a rejected dispatch;
 *   4. give up only after the retry budget, so a failure that is shown to the
 *      customer means the runtime stayed unreachable.
 *
 * `deliverOnce` additionally joins concurrent deliveries of the same key, so
 * a double submit (or a retry racing the first attempt) sends one message.
 */
export type DeliveryState = "connecting" | "sent" | "failed";

export type DeliverMessageOptions = {
  /** Resolves true when the chat runtime can take the message. */
  waitUntilReady: () => Promise<boolean>;
  /** True when the session document already carries this message id. */
  isDelivered: () => Promise<boolean>;
  /** Writes the message into the session document. */
  send: () => Promise<void>;
  /** Receives every state change (for a "Connecting…" line). */
  onState?: (state: DeliveryState) => void;
  /** Dispatch attempts after the runtime is ready. Default 3. */
  attempts?: number;
  /** Backoff between dispatch attempts. Default 500 ms doubling to 4 s. */
  delayMs?: (attempt: number) => number;
  /** Timer seam for tests. */
  wait?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

export const DELIVERY_ATTEMPTS = 3;
export const DELIVERY_BASE_DELAY_MS = 500;
export const DELIVERY_MAX_DELAY_MS = 4_000;

export function deliveryBackoff(attempt: number): number {
  return Math.min(DELIVERY_MAX_DELAY_MS, DELIVERY_BASE_DELAY_MS * 2 ** attempt);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Delivers one message; see the module comment for the order of checks. */
export async function deliverMessage(
  options: DeliverMessageOptions,
): Promise<DeliveryState> {
  const {
    waitUntilReady,
    isDelivered,
    send,
    onState = () => {},
    attempts = DELIVERY_ATTEMPTS,
    delayMs = deliveryBackoff,
    wait = sleep,
    signal,
  } = options;

  try {
    if (await isDelivered()) {
      onState("sent");
      return "sent";
    }
  } catch {
    // Unreadable document: treat as not delivered and let the send decide.
  }
  if (signal?.aborted) {
    onState("failed");
    return "failed";
  }

  onState("connecting");
  let ready = false;
  try {
    ready = await waitUntilReady();
  } catch {
    ready = false;
  }
  if (!ready || signal?.aborted) {
    onState("failed");
    return "failed";
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) {
      onState("failed");
      return "failed";
    }
    try {
      await send();
      onState("sent");
      return "sent";
    } catch {
      // The dispatch was refused — but it may have landed before the error.
      // Re-check the document: never send the same message twice.
      try {
        if (await isDelivered()) {
          onState("sent");
          return "sent";
        }
      } catch {
        // Unreadable: treat as not delivered and retry.
      }
    }
    if (attempt + 1 < attempts) await wait(delayMs(attempt));
  }
  onState("failed");
  return "failed";
}

const inFlight = new Map<string, Promise<DeliveryState>>();

/** One delivery per key: a second call joins the first instead of sending. */
export function deliverOnce(
  key: string,
  options: DeliverMessageOptions,
): Promise<DeliveryState> {
  const running = inFlight.get(key);
  if (running) return running;
  const delivery = deliverMessage(options).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, delivery);
  return delivery;
}

/** The chat-session fields this check reads from the reactor document. */
type SessionDocument = {
  state?: { global?: { messages?: readonly { id?: string }[] } };
};

/** The Studio host injects the reactor client on `window.ph`. */
type StudioWindow = Window & {
  ph?: {
    reactorClientModule?: {
      client?: { get: (id: string) => Promise<unknown> };
    };
  };
};

/** Resolves whether the session document carries `messageId` (real check). */
export async function sessionHasMessage(
  sessionId: string,
  messageId: string,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const client = (window as StudioWindow).ph?.reactorClientModule?.client;
  if (!client) return false;
  try {
    // The reactor's own type is the generic PHBaseState; this document is a
    // chat session, whose global state has the messages array.
    const document = (await client.get(sessionId)) as SessionDocument;
    return (
      document.state?.global?.messages?.some((m) => m.id === messageId) ?? false
    );
  } catch {
    return false;
  }
}
