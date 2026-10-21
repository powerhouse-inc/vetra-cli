// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaScreen } from "../idea/IdeaScreen.js";
import { resetLanguageStore } from "../i18n/useT.js";
import { button, click, render } from "../test-utils/render.js";

vi.mock("../idea/useStudioSignIn.js", () => ({
  useStudioSignIn: () => ({
    status: "signed-out",
    name: undefined,
    hasUser: false,
    signIn: () => {},
    signOut: () => {},
  }),
}));
vi.mock("../budget/useStudioBudget.js", () => ({
  useStudioBudget: () => ({
    snapshot: { usage: null },
    request: () => {},
    markExhausted: () => {},
  }),
}));
vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePHToast: () => undefined,
}));

beforeEach(() => {
  window.localStorage.clear();
  resetLanguageStore();
});

describe("AccountMenu language", () => {
  it("choosing Deutsch switches the idea screen heading", () => {
    const c = render(
      <IdeaScreen
        onStart={() => Promise.resolve(undefined)}
        onStarted={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(c.querySelector("h1")?.textContent).toBe(
      "What do you want to build?",
    );
    click(button(c, "Account"));
    const items = c.querySelectorAll('[role="menuitemradio"]');
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute("aria-checked")).toBe("true");
    click(button(c, "Deutsch"));
    expect(c.querySelector("h1")?.textContent).toBe("Was möchtest du bauen?");
    expect(window.localStorage.getItem("vetra-studio:language")).toBe("de");
    click(button(c, "Konto"));
    const after = c.querySelectorAll('[role="menuitemradio"]');
    expect(after[1]?.getAttribute("aria-checked")).toBe("true");
  });
});
