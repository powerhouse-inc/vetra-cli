// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import {
  PUBLISH_PERMISSION_TITLE,
  PublishPermissionModal,
} from "./PublishPermissionModal.js";

const hoisted = vi.hoisted(() => ({
  hasUser: true,
  permission: {
    state: "UNKNOWN",
    delegated: false,
    pending: false,
    waiting: false,
    allow: vi.fn(() => Promise.resolve(true)),
    reopen: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../idea/useStudioSignIn.js", () => ({
  useStudioSignIn: () => ({
    status: "signed-in",
    name: undefined,
    hasUser: hoisted.hasUser,
    signIn: () => {},
    signOut: () => {},
  }),
}));

vi.mock("./usePublishPermission.js", () => ({
  usePublishPermission: () => hoisted.permission,
}));

const STUDIO = "studio-1";

beforeEach(() => {
  window.localStorage.clear();
  hoisted.hasUser = true;
  hoisted.permission = {
    state: "UNKNOWN",
    delegated: false,
    pending: false,
    waiting: false,
    allow: vi.fn(() => Promise.resolve(true)),
    reopen: vi.fn(() => Promise.resolve()),
  };
});

function ask() {
  return render(
    <PublishPermissionModal productId="product-1" studioId={STUDIO} />,
  );
}

function dialog(container: HTMLElement): Element | null {
  return container.querySelector('[role="dialog"]');
}

describe("PublishPermissionModal", () => {
  it("does not ask in a Studio that needs no sign-in (no Renown user)", () => {
    hoisted.hasUser = false;
    const container = ask();
    expect(dialog(container)).toBeNull();
  });

  it("asks once after sign-in and not again after accepting", async () => {
    const container = ask();
    expect(container.textContent).toContain(PUBLISH_PERMISSION_TITLE);
    expectNoForbiddenWords(container);

    click(button(container, "Allow"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(hoisted.permission.allow).toHaveBeenCalledTimes(1);
    expect(dialog(container)).toBeNull();

    // A fresh visit to this Studio does not ask again.
    const again = ask();
    expect(dialog(again)).toBeNull();
  });

  it("declining does not block the build", () => {
    const container = render(
      <div>
        <PublishPermissionModal productId="product-1" studioId={STUDIO} />
        <p>Build in progress</p>
      </div>,
    );

    click(button(container, "Not now"));

    expect(dialog(container)).toBeNull();
    expect(container.textContent).toContain("Build in progress");
    expect(hoisted.permission.allow).not.toHaveBeenCalled();
    // The answer is remembered: no ask on the next visit either.
    const again = ask();
    expect(dialog(again)).toBeNull();
  });

  it("does not ask when the delegation or the recorded permission is already granted", () => {
    hoisted.permission = { ...hoisted.permission, delegated: true };
    expect(dialog(ask())).toBeNull();

    window.localStorage.clear();
    hoisted.permission = {
      ...hoisted.permission,
      delegated: false,
      state: "GRANTED",
    };
    expect(dialog(ask())).toBeNull();
  });

  it("offers to open Renown again while the approval is still waiting", () => {
    hoisted.permission = {
      ...hoisted.permission,
      pending: true,
      waiting: true,
    };
    const container = ask();

    expect(container.textContent).toContain(
      "Waiting for you to approve in Renown.",
    );
    expectNoForbiddenWords(container);
    const again = button(container, "Open Renown again");
    expect(again).toBeDefined();
    expect(again?.disabled).toBe(false);
    expect(button(container, "Allow")).toBeUndefined();

    click(again);
    expect(hoisted.permission.reopen).toHaveBeenCalledTimes(1);
    expect(hoisted.permission.allow).not.toHaveBeenCalled();
    // The ask stays open until Renown reports the approval.
    expect(dialog(container)).not.toBeNull();

    click(button(container, "Not now"));
    expect(dialog(container)).toBeNull();
  });

  it("keeps Allow disabled while a confirmation is being recorded", () => {
    hoisted.permission = {
      ...hoisted.permission,
      pending: true,
      waiting: false,
    };
    const container = ask();

    expect(button(container, "Open Renown again")).toBeUndefined();
    expect(button(container, "Waiting for Renown")?.disabled).toBe(true);
  });
});
