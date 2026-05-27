/**
 * `GET /events` — SSE stream of reactor-project lifecycle changes.
 *
 * Trigger context only exposes `on` (no `off`), so we subscribe once per
 * event type at server startup and fan out to every connected SSE client.
 * Subscriptions live for the trigger's lifetime (= daemon lifetime); per-
 * client cleanup removes the response from the broadcast set on disconnect.
 *
 * A 15s heartbeat comment keeps middleboxes and node's default request
 * timeout from closing the stream during quiet periods.
 */
import type { ServerResponse } from "node:http";
import type { SseEvent } from "./config.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

type ServiceEvent = {
  id?: string;
  instanceId?: string;
  endpoints?: Record<string, string>;
  error?: string;
};

const FORWARDED: Array<SseEvent["type"]> = [
  "service:starting",
  "service:ready",
  "service:stopped",
  "service:restarting",
  "service:failed",
];

export interface SseBroadcaster {
  attach: (res: ServerResponse) => () => void;
  stop: () => void;
}

export function createSseBroadcaster(args: {
  subscribe: (eventName: string, handler: (raw: unknown) => void) => void;
}): SseBroadcaster {
  const clients = new Set<ServerResponse>();

  const broadcast = (event: SseEvent) => {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        // Dead socket — the close handler will remove it on next event-loop tick.
      }
    }
  };

  for (const type of FORWARDED) {
    args.subscribe(type, (raw) => {
      const e = raw as ServiceEvent;
      if (e?.id !== "reactor-project") return;
      broadcast({ type, instanceId: e.instanceId, error: e.error });
    });
  }

  const heartbeat = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(": ping\n\n");
      } catch {
        // ignore
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  return {
    attach(res) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no",
      });
      res.write(": connected\n\n");
      clients.add(res);

      const detach = () => {
        clients.delete(res);
        try {
          res.end();
        } catch {
          // ignore
        }
      };
      res.on("close", detach);
      res.on("error", detach);
      return detach;
    },
    stop() {
      clearInterval(heartbeat);
      for (const res of clients) {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
      clients.clear();
    },
  };
}
