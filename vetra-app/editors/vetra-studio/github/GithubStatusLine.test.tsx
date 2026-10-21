// @vitest-environment happy-dom
import {
  BRING_IN_REQUEST,
  type StudioProductState,
} from "document-models/studio-product";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import {
  PRODUCT_ID,
  at,
  buildingOps,
  drive,
  productDoc,
  withLiveVersion,
} from "../test-utils/studioFixtures.js";
import { GithubStatusLine } from "./GithubStatusLine.js";

const hoisted = vi.hoisted(() => ({
  dispatched: [] as { action: { type?: string }; id: string }[],
  startChange: vi.fn((_input: unknown) =>
    Promise.resolve({
      changeId: "c2",
      sessionId: "s2",
      joined: false,
    }),
  ),
}));

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dispatchActions: (
    action: { type?: string },
    id: string,
  ): Promise<undefined> => {
    hoisted.dispatched.push({ action, id });
    return Promise.resolve(undefined);
  },
}));
vi.mock("../change/startChange.js", () => ({
  startChange: hoisted.startChange,
}));
vi.mock("./ConnectGithubDialog.js", () => ({
  ConnectGithubDialog: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Connect GitHub">
      GitHub dialog
      <button type="button" onClick={onClose}>
        Close dialog
      </button>
    </div>
  ),
}));

function liveProduct(): StudioProductState {
  return readProduct(
    withLiveVersion(productDoc(...buildingOps()), { launchedAt: at(25) }).state
      .global,
  );
}

function beforeLaunch(): StudioProductState {
  return readProduct(productDoc(...buildingOps()).state.global);
}

function renderLine(product: StudioProductState) {
  return render(
    <GithubStatusLine
      product={product}
      productId={PRODUCT_ID}
      drive={drive([])}
      requestedBy="Frank"
    />,
  );
}

beforeEach(() => {
  hoisted.dispatched = [];
  hoisted.startChange.mockClear();
});

describe("GithubStatusLine", () => {
  it("no GitHub prompt before the first launch", () => {
    const container = renderLine(beforeLaunch());
    expect(container.textContent).toBe("");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("not connected: the exact line, and Connect GitHub opens the dialog", () => {
    const container = renderLine(liveProduct());
    expect(container.textContent).toBe(
      "Code saved in your Studio · Connect GitHub",
    );
    click(button(container, "Connect GitHub"));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "GitHub dialog",
    );
    expectNoForbiddenWords(container);
  });

  it("connected: GitHub ✓", () => {
    const product = liveProduct();
    product.github.status = "CONNECTED";
    const container = renderLine(product);
    expect(container.textContent).toBe("GitHub ✓");
    expectNoForbiddenWords(container);
  });

  it("disconnected: the exact sentence, and Reconnect opens the dialog", () => {
    const product = liveProduct();
    product.github.status = "DISCONNECTED";
    const container = renderLine(product);
    expect(container.textContent).toBe(
      "GitHub disconnected — your code is still saved in the Studio. Reconnect",
    );
    click(button(container, "Reconnect"));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expectNoForbiddenWords(container);
  });

  it("push failed: the plain reason and Retry now asks for the mirror", () => {
    const product = liveProduct();
    product.github.status = "PUSH_FAILED";
    product.github.lastError = "GitHub didn't answer";
    const container = renderLine(product);
    expect(container.textContent).toContain(
      "Couldn't save to GitHub (GitHub didn't answer). Will retry with the next launch.",
    );
    click(button(container, "Retry now"));
    expect(hoisted.dispatched).toMatchObject([
      {
        action: {
          type: "REQUEST_MIRROR",
          input: { requestedBy: "Frank" },
        },
        id: PRODUCT_ID,
      },
    ]);
    expectNoForbiddenWords(container);
  });

  it("changes on GitHub outside the Studio: Bring them in starts the change", async () => {
    const product = liveProduct();
    product.github.status = "CONNECTED";
    product.github.externalChangesSha = "abc1234";
    const container = renderLine(product);
    expect(container.textContent).toBe(
      "There are changes on GitHub that aren't in your Studio Bring them in",
    );
    click(button(container, "Bring them in"));
    await vi.waitFor(() => expect(hoisted.startChange).toHaveBeenCalled());
    expect(hoisted.startChange.mock.calls[0]?.[0]).toMatchObject({
      productId: PRODUCT_ID,
      request: BRING_IN_REQUEST,
      kind: "CHANGE",
    });
    expectNoForbiddenWords(container);
  });

  it("Bring them in says a plain reason when it can't start", async () => {
    hoisted.startChange.mockRejectedValueOnce(
      new Error("Finish or discard your change first."),
    );
    const product = liveProduct();
    product.github.status = "CONNECTED";
    product.github.externalChangesSha = "abc1234";
    const container = renderLine(product);
    click(button(container, "Bring them in"));
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Finish or discard your change first.",
      ),
    );
  });
});
