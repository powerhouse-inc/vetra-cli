// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import {
  ConnectGithubDialog,
  POLL_INTERVAL_MS,
  POLL_LIMIT_MS,
} from "./ConnectGithubDialog.js";
import type * as GithubClientModule from "./githubClient.js";
import type {
  AttachStudioRepositoryResult,
  GithubDeployAppInfo,
  GithubDeployInstallation,
} from "./githubClient.js";

const hoisted = vi.hoisted(() => {
  const renown = { getBearerToken: () => Promise.resolve("test-token") };
  return {
    renown,
    appInfo: null as GithubDeployAppInfo | null,
    installations: [] as GithubDeployInstallation[],
    pollCalls: 0,
    attach: vi.fn<
      (
        input: { appId: string; installationId: string; name?: string },
        token: string | null,
      ) => Promise<AttachStudioRepositoryResult>
    >(() => Promise.resolve({ ok: true })),
  };
});

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRenown: () => hoisted.renown,
}));
vi.mock("./githubClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof GithubClientModule>();
  return {
    ...actual,
    fetchGithubDeployAppInfo: () => Promise.resolve(hoisted.appInfo),
    fetchMyGithubDeployInstallations: () => {
      hoisted.pollCalls += 1;
      return Promise.resolve(hoisted.installations);
    },
    attachStudioRepository: (
      input: { appId: string; installationId: string; name?: string },
      token: string | null,
    ) => hoisted.attach(input, token),
  };
});

const APP_INFO: GithubDeployAppInfo = {
  slug: "vetra-studio",
  installUrl: "https://github.com/apps/vetra-studio/installations/new",
  authorizeUrl: "https://github.com/login/oauth/authorize?client_id=x",
};
const PERSONAL: GithubDeployInstallation = {
  installationId: "inst-1",
  accountLogin: "froid1911",
  accountType: "User",
};
const ORG: GithubDeployInstallation = {
  installationId: "inst-2",
  accountLogin: "acme",
  accountType: "Organization",
};

/** Flushes the dialog's async load without real time. */
async function settle(): Promise<void> {
  await act(async () => {});
}

function renderDialog(appId: string | null = "app-1") {
  return render(
    <ConnectGithubDialog
      appId={appId}
      productName="Task board"
      onClose={() => {}}
    />,
  );
}

let open: { mockRestore(): void };

beforeEach(() => {
  hoisted.appInfo = APP_INFO;
  hoisted.installations = [];
  hoisted.pollCalls = 0;
  hoisted.attach.mockReset();
  hoisted.attach.mockResolvedValue({ ok: true });
  open = vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
  open.mockRestore();
  vi.useRealTimers();
});

describe("ConnectGithubDialog", () => {
  it("account and org choices come from installations", async () => {
    hoisted.installations = [PERSONAL, ORG];
    const container = renderDialog();
    await settle();
    expect(container.textContent).toContain("Where should your code go?");
    expect(container.textContent).toContain("froid1911");
    expect(container.textContent).toContain("personal account");
    expect(container.textContent).toContain("acme");
    expect(container.textContent).toContain("organisation");
    expectNoForbiddenWords(container);
  });

  it("org policy refusal shows the ask-an-owner message", async () => {
    hoisted.installations = [ORG];
    hoisted.attach.mockResolvedValue({
      ok: false,
      code: "ORG_POLICY",
      message:
        "Ask an owner of acme to allow Vetra, or choose your personal account.",
    });
    const container = renderDialog();
    await settle();
    click(button(container, "acme"));
    await settle();
    expect(
      (container.querySelector("#studio-github-repo-name") as HTMLInputElement)
        .value,
    ).toBe("task-board");
    click(button(container, "Connect GitHub"));
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Ask an owner of acme to allow Vetra, or choose your personal account.",
    );
    expect(hoisted.attach).toHaveBeenCalledWith(
      { appId: "app-1", installationId: "inst-2", name: "task-board" },
      "test-token",
    );
    expectNoForbiddenWords(container);
  });

  it("connects the chosen personal account and says so", async () => {
    hoisted.installations = [PERSONAL];
    const container = renderDialog();
    await settle();
    click(button(container, "froid1911"));
    await settle();
    click(button(container, "Connect GitHub"));
    await settle();
    expect(hoisted.attach).toHaveBeenCalledWith(
      { appId: "app-1", installationId: "inst-1", name: "task-board" },
      "test-token",
    );
    expect(container.textContent).toContain("GitHub is connected.");
    expectNoForbiddenWords(container);
  });

  it("opens GitHub and polls until the new account appears", async () => {
    vi.useFakeTimers();
    hoisted.installations = [];
    const container = renderDialog();
    await settle();
    click(button(container, "Connect GitHub"));
    expect(open).toHaveBeenCalledWith(
      APP_INFO.installUrl,
      "_blank",
      "noopener,noreferrer",
    );
    expect(container.textContent).toContain("Waiting for GitHub…");
    expectNoForbiddenWords(container);

    hoisted.installations = [PERSONAL];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(container.textContent).toContain("froid1911");
    expect(container.textContent).toContain("personal account");
    expect(container.textContent).not.toContain("Waiting for GitHub…");
  });

  it("gives up after two minutes instead of spinning forever", async () => {
    vi.useFakeTimers();
    hoisted.installations = [];
    const container = renderDialog();
    await settle();
    click(button(container, "Connect GitHub"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_LIMIT_MS);
    });
    expect(container.textContent).toContain("GitHub didn't answer. Try again.");
    expect(button(container, "Try again")).toBeDefined();
    expect(container.textContent).not.toContain("Waiting for GitHub…");
  });

  it("Cancel stops the polling", async () => {
    vi.useFakeTimers();
    hoisted.installations = [];
    const container = renderDialog();
    await settle();
    click(button(container, "Connect GitHub"));
    click(button(container, "Cancel"));
    const before = hoisted.pollCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(hoisted.pollCalls).toBe(before);
  });

  it("a cloud that can't be reached says so and offers Try again", async () => {
    hoisted.appInfo = null;
    const container = renderDialog();
    await settle();
    expect(container.textContent).toContain(
      "Couldn't reach GitHub. Check your connection and try again.",
    );
    expect(button(container, "Try again")).toBeDefined();
    expect(container.textContent).not.toContain("Checking GitHub…");
    expectNoForbiddenWords(container);
  });
});
