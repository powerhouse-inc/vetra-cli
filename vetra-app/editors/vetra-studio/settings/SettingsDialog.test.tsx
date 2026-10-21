// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import {
  button,
  click,
  pressKey,
  render,
  typeInto,
} from "../test-utils/render.js";
import {
  PRODUCT_ID,
  at,
  buildingOps,
  productDoc,
  withLiveVersion,
} from "../test-utils/studioFixtures.js";
import { SettingsDialog } from "./SettingsDialog.js";

const hoisted = vi.hoisted(() => ({
  dispatched: [] as { action: unknown; id: string }[],
}));

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dispatchActions: (action: unknown, id: string) => {
    hoisted.dispatched.push({ action, id });
    return Promise.resolve(undefined);
  },
}));
vi.mock("../DeploySection.js", () => ({
  DeploySection: () => <div>Deploy environments and packages</div>,
}));
vi.mock("../AgentAuthButton.js", () => ({ AgentAuthButton: () => null }));
vi.mock("../WorkspaceExportButton.js", () => ({
  WorkspaceExportButton: () => null,
}));
vi.mock("../VersionBadge.js", () => ({ VersionBadge: () => null }));
vi.mock("../budget/BudgetMeter.js", () => ({
  StudioBudgetMeter: () => <span>$0.31 of $10</span>,
}));

const product = () => readProduct(productDoc(...buildingOps()).state.global);
const live = () =>
  readProduct(
    withLiveVersion(productDoc(...buildingOps()), { launchedAt: at(25) }).state
      .global,
  );

beforeEach(() => {
  hoisted.dispatched = [];
});

describe("SettingsDialog", () => {
  it("renames the product", async () => {
    const container = render(
      <SettingsDialog
        product={product()}
        productId={PRODUCT_ID}
        onClose={() => {}}
      />,
    );
    typeInto(container.querySelector("#studio-product-name"), "Team tasks");
    click(button(container, "Save"));
    await vi.waitFor(() =>
      expect(hoisted.dispatched).toMatchObject([
        {
          action: { type: "RENAME_PRODUCT", input: { name: "Team tasks" } },
          id: PRODUCT_ID,
        },
      ]),
    );
  });

  it("Advanced mounts only when expanded; no forbidden words while collapsed", () => {
    const container = render(
      <SettingsDialog
        product={product()}
        productId={PRODUCT_ID}
        onClose={() => {}}
      />,
    );
    expect(container.textContent).not.toContain("Deploy environments");
    expectNoForbiddenWords(container);

    click(button(container, "Advanced"));
    expect(container.textContent).toContain("Deploy environments");
  });

  it("Escape closes it, but not while a dialog inside it is open", () => {
    const onClose = vi.fn();
    render(
      <SettingsDialog
        product={product()}
        productId={PRODUCT_ID}
        onClose={onClose}
      />,
    );
    const inner = document.createElement("div");
    inner.setAttribute("role", "dialog");
    document.body.appendChild(inner);
    pressKey(window, "Escape");
    expect(onClose).not.toHaveBeenCalled();

    inner.remove();
    pressKey(window, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsDialog — the live product", () => {
  it("shows the live address read-only", () => {
    const container = render(
      <SettingsDialog
        product={live()}
        productId={PRODUCT_ID}
        onClose={() => {}}
      />,
    );
    expect(container.textContent).toContain("https://task-board.vetra.io");
    expect(
      container.querySelector('input[value="https://task-board.vetra.io"]'),
    ).toBeNull();
  });

  it("the access switch dispatches SET_ACCESS on the product", async () => {
    const container = render(
      <SettingsDialog
        product={live()}
        productId={PRODUCT_ID}
        onClose={() => {}}
      />,
    );
    const anyone = container.querySelector(
      'input[value="SIGNED_IN"]',
    ) as HTMLInputElement;
    const onlyMe = container.querySelector(
      'input[value="OWNER_ONLY"]',
    ) as HTMLInputElement;
    expect(anyone.checked).toBe(true);
    click(onlyMe);
    await vi.waitFor(() =>
      expect(hoisted.dispatched).toMatchObject([
        {
          action: { type: "SET_ACCESS", input: { access: "OWNER_ONLY" } },
          id: PRODUCT_ID,
        },
      ]),
    );
    expect(container.textContent).toContain(
      "Anyone with the link can sign in and use it.",
    );
    expectNoForbiddenWords(container);
  });

  it("'Change who can use it' opens it on the access switch", () => {
    render(
      <SettingsDialog
        product={live()}
        productId={PRODUCT_ID}
        initialSection="access"
        onClose={() => {}}
      />,
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Who can use it",
    );
  });
});
