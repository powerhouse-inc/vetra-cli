// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test-utils/render.js";
import type { AuthState } from "./preview-server-client.js";
import {
  RENOWN_LOGIN_LIFETIME_MS,
  useAgentAuth,
  type AgentAuth,
} from "./useAgentAuth.js";

const hoisted = vi.hoisted(() => {
  const state: { status: AuthState; started: AuthState } = {
    status: { authenticated: false },
    started: { authenticated: false },
  };
  return { ...state, startAuth: vi.fn() };
});

vi.mock("./preview-server-client.js", () => ({
  fetchAuthStatus: () => Promise.resolve(hoisted.status),
  confirmAuth: () => new Promise<AuthState>(() => {}),
  logoutAuth: () => Promise.resolve({ authenticated: false }),
  startAuth: hoisted.startAuth,
}));

const PENDING_URL = "https://renown.example/console?session=s1";
const FRESH_URL = "https://renown.example/console?session=s2";

let auth: AgentAuth | undefined;
function Probe() {
  auth = useAgentAuth();
  return null;
}

async function mount(): Promise<AgentAuth> {
  render(<Probe />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  if (!auth) throw new Error("hook did not render");
  return auth;
}

let popup: { location: { href: string }; close: () => void };

beforeEach(() => {
  auth = undefined;
  hoisted.status = { authenticated: false };
  hoisted.started = {
    authenticated: false,
    pending: { loginUrl: FRESH_URL, startedAt: Date.now(), ageMs: 0 },
  };
  hoisted.startAuth.mockReset();
  hoisted.startAuth.mockImplementation(() => Promise.resolve(hoisted.started));
  popup = { location: { href: "about:blank" }, close: vi.fn() };
  vi.spyOn(window, "open").mockImplementation(() => popup as unknown as Window);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAgentAuth reopen", () => {
  it("reopens the pending Renown login without starting a new one", async () => {
    hoisted.status = {
      authenticated: false,
      pending: { loginUrl: PENDING_URL, startedAt: Date.now(), ageMs: 2000 },
    };
    const current = await mount();
    expect(current.pending).toBe(true);

    await act(async () => {
      await current.reopen();
    });

    expect(window.open).toHaveBeenCalledWith(
      PENDING_URL,
      "_blank",
      "noopener,noreferrer",
    );
    expect(hoisted.startAuth).not.toHaveBeenCalled();
  });

  it("starts a login when there is no pending Renown URL", async () => {
    const current = await mount();
    expect(current.pending).toBe(false);

    await act(async () => {
      await current.reopen();
    });

    expect(hoisted.startAuth).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toBe(FRESH_URL);
  });

  it("treats a login older than the Renown session lifetime as not pending", async () => {
    hoisted.status = {
      authenticated: false,
      pending: {
        loginUrl: PENDING_URL,
        startedAt: Date.now(),
        ageMs: RENOWN_LOGIN_LIFETIME_MS + 1000,
      },
    };
    const current = await mount();
    expect(current.pending).toBe(false);

    await act(async () => {
      await current.reopen();
    });

    expect(hoisted.startAuth).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toBe(FRESH_URL);
  });

  it("judges the age by the daemon, not by a skewed browser clock", async () => {
    const daemonNow = Date.now();
    hoisted.status = {
      authenticated: false,
      pending: { loginUrl: PENDING_URL, startedAt: daemonNow, ageMs: 2000 },
    };
    // The browser runs an hour ahead of the daemon.
    vi.spyOn(Date, "now").mockReturnValue(daemonNow + 60 * 60 * 1000);
    const current = await mount();
    expect(current.pending).toBe(true);

    await act(async () => {
      await current.reopen();
    });

    expect(window.open).toHaveBeenCalledWith(
      PENDING_URL,
      "_blank",
      "noopener,noreferrer",
    );
    expect(hoisted.startAuth).not.toHaveBeenCalled();
  });
});
