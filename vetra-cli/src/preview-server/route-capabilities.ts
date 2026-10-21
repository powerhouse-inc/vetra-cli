/**
 * Every route the preview server serves, with the capability it requires
 * (P6-3, P6-12). A route missing here is a route nobody decided on: the
 * coverage test scans the route modules and fails when one has no entry.
 *
 * "public" routes are reachable by anyone who can reach the Studio; the owner
 * routes that predate teams keep their owner-only behaviour through
 * `exportWorkspace` (`requireOwner` is that check).
 */
import type { Capability } from "../team/roles.js";

export type RouteCapability = Capability | "public";

export interface RouteRule {
  method: string;
  /** Exact request path, before the query string. */
  path: string;
  cap: RouteCapability;
}

export const ROUTE_CAPABILITIES: readonly RouteRule[] = [
  // Public: liveness, versions, preview readiness, events, and "can I export?".
  { method: "GET", path: "/healthz", cap: "public" },
  { method: "GET", path: "/version", cap: "public" },
  { method: "GET", path: "/resolve", cap: "public" },
  { method: "GET", path: "/events", cap: "public" },
  { method: "GET", path: "/export/status", cap: "public" },

  // Owner-only routes as before (owner gate, now expressed as a capability).
  { method: "GET", path: "/project-package", cap: "exportWorkspace" },
  { method: "GET", path: "/release-status", cap: "exportWorkspace" },
  { method: "GET", path: "/sessions", cap: "exportWorkspace" },
  { method: "GET", path: "/sessions/export", cap: "exportWorkspace" },
  { method: "GET", path: "/export", cap: "exportWorkspace" },
  { method: "GET", path: "/auth/status", cap: "exportWorkspace" },
  { method: "POST", path: "/auth/start", cap: "exportWorkspace" },
  { method: "POST", path: "/auth/logout", cap: "exportWorkspace" },
  { method: "POST", path: "/auth/confirm", cap: "exportWorkspace" },

  // Making and publishing a change (P6-3: Owners and Makers).
  { method: "POST", path: "/start", cap: "startChange" },
  { method: "POST", path: "/publish", cap: "launch" },
  { method: "POST", path: "/restart", cap: "restart" },

  // Team routes (task 1.9). `/team/relay` additionally checks each action's
  // own type (comment vs steer) inside the handler.
  { method: "GET", path: "/team/me", cap: "view" },
  { method: "GET", path: "/team/members", cap: "view" },
  { method: "POST", path: "/team/relay", cap: "comment" },
];

export function routeCapability(method: string, path: string): RouteCapability | undefined {
  return ROUTE_CAPABILITIES.find((r) => r.method === method && r.path === path)?.cap;
}
