// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAuth } from "../hooks/useAgentAuth.js";
import { render, rerender } from "../test-utils/render.js";
import {
  usePublishPermission,
  type PublishPermission,
} from "./usePublishPermission.js";

const hoisted = vi.hoisted(() => ({
  auth: {} as AgentAuth,
  dispatchActions: vi.fn(() => Promise.resolve()),
}));

vi.mock("../hooks/useAgentAuth.js", () => ({
  useAgentAuth: () => hoisted.auth,
}));

vi.mock("@powerhousedao/reactor-browser", () => ({
  dispatchActions: hoisted.dispatchActions,
  useDocumentSafe: () => ({ status: "loading" }),
}));

vi.mock("document-models/studio-product", () => ({
  actions: {
    setLaunchPermission: (input: { state: string }) => ({
      type: "SET_LAUNCH_PERMISSION",
      input,
    }),
  },
  isStudioProductDocument: () => false,
}));

function authWith(patch: Partial<AgentAuth>): AgentAuth {
  return {
    state: { authenticated: false },
    busy: false,
    authenticated: false,
    pending: false,
    authorize: vi.fn(() => Promise.resolve()),
    reopen: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    ...patch,
  };
}

let permission: PublishPermission | undefined;
function Probe() {
  permission = usePublishPermission("product-1");
  return null;
}

beforeEach(() => {
  permission = undefined;
  hoisted.dispatchActions.mockClear();
});

describe("usePublishPermission waiting", () => {
  it("is waiting while a Renown approval is pending and nothing is in flight", () => {
    hoisted.auth = authWith({ pending: true });
    render(<Probe />);
    expect(permission?.pending).toBe(true);
    expect(permission?.waiting).toBe(true);

    hoisted.auth = authWith({ pending: true, busy: true });
    const container = render(<Probe />);
    rerender(container, <Probe />);
    expect(permission?.waiting).toBe(false);
  });

  it("reopens Renown and records the OK once it is approved", async () => {
    hoisted.auth = authWith({ pending: true });
    const container = render(<Probe />);

    await act(async () => {
      await permission?.reopen();
    });
    expect(hoisted.auth.reopen).toHaveBeenCalledTimes(1);

    hoisted.auth = authWith({ authenticated: true });
    rerender(container, <Probe />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(hoisted.dispatchActions).toHaveBeenCalledWith(
      { type: "SET_LAUNCH_PERMISSION", input: { state: "GRANTED" } },
      "product-1",
    );
  });
});
