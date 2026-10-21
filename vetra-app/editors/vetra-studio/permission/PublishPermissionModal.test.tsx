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
  permission: {
    state: "UNKNOWN",
    delegated: false,
    pending: false,
    allow: vi.fn(() => Promise.resolve(true)),
  },
}));

vi.mock("../idea/useStudioSignIn.js", () => ({
  useStudioSignIn: () => ({
    status: "signed-in",
    name: undefined,
    hasUser: true,
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
  hoisted.permission = {
    state: "UNKNOWN",
    delegated: false,
    pending: false,
    allow: vi.fn(() => Promise.resolve(true)),
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
});
