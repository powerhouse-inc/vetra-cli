// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetLanguageStore, setLanguage } from "../i18n/useT.js";
import { button, click, render } from "../test-utils/render.js";
import type { Member } from "./capabilities.js";
import { MoveToOrg, ownerOrgs, type OrgOption } from "./MoveToOrg.js";
import type { Team } from "./useTeam.js";

const OWNER = "0x1111111111111111111111111111111111111111";

vi.mock("../idea/useStudioSignIn.js", () => ({
  useStudioSignIn: () => ({
    status: "signed-in",
    name: "Ada",
    address: "0x1111111111111111111111111111111111111111",
    hasUser: true,
    signIn: () => {},
    signOut: () => {},
  }),
}));

vi.mock("../hooks/preview-server-client.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveStudioEnvironmentId: () => Promise.resolve("env-1"),
}));

const owner: Member = {
  address: OWNER,
  name: "Ada",
  role: "owner",
  reviewer: false,
};

function team(over: Partial<Team> = {}): Team {
  return {
    me: owner,
    members: [],
    orgId: null,
    loading: false,
    unavailable: false,
    limited: false,
    needsAllow: false,
    refresh: () => {},
    ...over,
  };
}

const ORGS: OrgOption[] = [
  { id: "o-acme", name: "Acme Bau", role: "OWNER" },
  { id: "o-other", name: "Other GmbH", role: "ADMIN" },
  { id: "o-third", name: "Third AG", role: "MEMBER" },
];

function deps(orgs: OrgOption[] = ORGS) {
  return {
    loadOrgs: vi.fn(() => Promise.resolve(orgs)),
    move: vi.fn(() => Promise.resolve({ ownerOrgId: "o-acme" })),
  };
}

function optionTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("option")).map((o) =>
    String(o.textContent),
  );
}

function chooseOrg(container: HTMLElement, id: string): void {
  const select = container.querySelector("select");
  if (!(select instanceof HTMLSelectElement)) throw new Error("no picker");
  act(() => {
    Reflect.set(HTMLSelectElement.prototype, "value", id, select);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetLanguageStore();
});

describe("MoveToOrg", () => {
  it("move lists only orgs I own", async () => {
    const d = deps();
    const c = render(<MoveToOrg team={team()} deps={d} />);
    await vi.waitFor(() => expect(optionTexts(c)).toContain("Acme Bau"));
    // The placeholder plus the one org where the person is an OWNER.
    expect(optionTexts(c)).toEqual(["Choose an organisation", "Acme Bau"]);
    expect(ownerOrgs(ORGS).map((o) => o.id)).toEqual(["o-acme"]);
  });

  it("moves the Studio into the chosen organisation", async () => {
    const d = deps();
    const c = render(<MoveToOrg team={team()} deps={d} />);
    await vi.waitFor(() => expect(optionTexts(c)).toContain("Acme Bau"));
    chooseOrg(c, "o-acme");
    expect(c.textContent).toContain(
      "Moves this Studio and its remaining budget to Acme Bau. Members of Acme Bau get access by their role.",
    );
    const move = button(c, "Move to Acme Bau");
    expect(move?.disabled).toBe(false);
    click(move);
    await vi.waitFor(() => expect(d.move).toHaveBeenCalledWith("o-acme"));
    await vi.waitFor(() =>
      expect(c.textContent).toContain("This Studio now belongs to Acme Bau."),
    );
  });

  it("says when no organisation I own can take the Studio", async () => {
    const c = render(<MoveToOrg team={team()} deps={deps([ORGS[1]])} />);
    await vi.waitFor(() =>
      expect(c.textContent).toContain("You don't own an organisation yet."),
    );
  });

  it("says when the move isn't available here, instead of asking blindly", async () => {
    const d = deps();
    d.loadOrgs.mockImplementationOnce(() =>
      Promise.reject(new Error("no orgs endpoint")),
    );
    const c = render(<MoveToOrg team={team()} deps={d} />);
    await vi.waitFor(() =>
      expect(c.textContent).toContain(
        "Moving a Studio into an organisation isn't available here yet.",
      ),
    );
  });

  it("only a personal Studio's Owner is offered it", () => {
    const viewer: Member = {
      address: OWNER,
      name: "Vi",
      role: "viewer",
      reviewer: false,
    };
    expect(
      render(<MoveToOrg team={team({ me: viewer })} deps={deps()} />)
        .textContent,
    ).toBe("");
    expect(
      render(<MoveToOrg team={team({ orgId: "acme" })} deps={deps()} />)
        .textContent,
    ).toBe("");
  });

  it("speaks German when the Studio does", async () => {
    setLanguage("de");
    const c = render(<MoveToOrg team={team()} deps={deps()} />);
    await vi.waitFor(() => expect(optionTexts(c)).toContain("Acme Bau"));
    expect(c.textContent).toContain("In eine Organisation verschieben");
    expect(optionTexts(c)[0]).toBe("Organisation wählen");
    chooseOrg(c, "o-acme");
    expect(button(c, "Zu Acme Bau verschieben")).toBeDefined();
  });
});
