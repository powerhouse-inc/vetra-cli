// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage, resetLanguageStore } from "../i18n/useT.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import type { Member } from "./capabilities.js";
import { TeamPanel, type TeamPanelProps } from "./TeamPanel.js";
import type { TeamMember } from "./teamClient.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const MAKER = "0x2222222222222222222222222222222222222222";
const VIEWER = "0x3333333333333333333333333333333333333333";
const TEAM_DOC = "team-doc-1";
const NOW = "2026-10-22T10:00:00.000Z";

const hoisted = vi.hoisted(() => ({
  dispatched: [] as {
    type: string;
    input: Record<string, unknown>;
    id: string;
  }[],
}));

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dispatchActions: (
    action: { type: string; input: Record<string, unknown> },
    id: string,
  ) => {
    hoisted.dispatched.push({ type: action.type, input: action.input, id });
    return Promise.resolve();
  },
}));

vi.mock("../AgentAuthButton.js", () => ({
  AgentAuthButton: () => <span data-agent-auth />,
}));

const me: Member = {
  address: OWNER,
  name: "Ada",
  role: "owner",
  reviewer: false,
};
const members: TeamMember[] = [
  {
    address: OWNER,
    name: "Ada",
    role: "owner",
    reviewer: false,
    allowedAgent: true,
    overridden: false,
  },
  {
    address: MAKER,
    name: "Mo",
    role: "maker",
    reviewer: true,
    allowedAgent: false,
    overridden: false,
  },
  {
    address: VIEWER,
    name: "Vi",
    role: "viewer",
    reviewer: false,
    allowedAgent: false,
    overridden: false,
  },
];

function panel(over: Partial<TeamPanelProps> = {}) {
  return render(
    <TeamPanel
      me={me}
      members={members}
      limited={false}
      unavailable={false}
      needsAllow={false}
      teamDocumentId={TEAM_DOC}
      onClose={() => {}}
      now={() => new Date(NOW)}
      {...over}
    />,
  );
}

/** The dispatch promise settles outside the click's act: let React see it. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function row(container: HTMLElement, address: string): HTMLElement {
  const el = container.querySelector(`[data-member="${address}"]`);
  if (!el) throw new Error(`no row for ${address}`);
  return el as HTMLElement;
}

beforeEach(() => {
  hoisted.dispatched = [];
  window.localStorage.clear();
  resetLanguageStore();
});

describe("TeamPanel", () => {
  it("shows each member's name and role, the Reviewer badge and their agent access", () => {
    const c = panel();
    expect(c.querySelector("h2")?.textContent).toBe("Team");
    expect(row(c, MAKER).textContent).toContain("Mo");
    expect(row(c, MAKER).textContent).toContain("Maker");
    expect(row(c, MAKER).textContent).toContain("Reviewer");
    expect(row(c, VIEWER).textContent).toContain("Viewer");
    expect(row(c, OWNER).textContent).toContain("Owner");
    expect(row(c, OWNER).textContent).toContain("Agent allowed");
    expect(row(c, OWNER).textContent).toContain("you");
    expectNoForbiddenWords(c);
  });

  it("owner toggles reviewer", async () => {
    const c = panel();
    // Mo is a Reviewer: the switch turns it off with REMOVE_REVIEWER.
    const off = button(c, "Reviewer Mo");
    expect(off?.getAttribute("aria-checked")).toBe("true");
    click(off);
    await flush();
    expect(hoisted.dispatched).toEqual([
      { type: "REMOVE_REVIEWER", input: { address: MAKER }, id: TEAM_DOC },
    ]);

    // Vi is not: the switch adds her with ADD_REVIEWER, recording who and when.
    const on = button(c, "Reviewer Vi");
    expect(on?.getAttribute("aria-checked")).toBe("false");
    click(on);
    await flush();
    expect(hoisted.dispatched[1]).toMatchObject({
      type: "ADD_REVIEWER",
      id: TEAM_DOC,
      input: { address: VIEWER, name: "Vi", at: NOW },
    });
  });

  it("an owner can limit a Maker to watching here, and lift it", async () => {
    const limited = panel({
      members: [members[0], { ...members[1], overridden: true }, members[2]],
    });
    expect(row(limited, MAKER).textContent).toContain("Can only watch here");
    const switchOff = button(limited, "Can only watch here Mo");
    expect(switchOff?.getAttribute("aria-checked")).toBe("true");
    click(switchOff);
    await flush();
    expect(hoisted.dispatched).toEqual([
      { type: "CLEAR_ROLE_OVERRIDE", input: { address: MAKER }, id: TEAM_DOC },
    ]);

    hoisted.dispatched = [];
    const c = panel();
    click(button(c, "Can only watch here Mo"));
    await flush();
    expect(hoisted.dispatched).toEqual([
      {
        type: "SET_ROLE_OVERRIDE",
        input: { address: MAKER, role: "VIEWER", at: NOW },
        id: TEAM_DOC,
      },
    ]);
    // A real Viewer has no override switch.
    expect(button(c, "Can only watch here Vi")).toBeUndefined();
  });

  it("the owner's own row has no controls", () => {
    const c = panel();
    expect(row(c, OWNER).querySelector('[role="switch"]')).toBeNull();
  });

  it("a Maker sees no owner controls", () => {
    const maker: Member = {
      address: MAKER,
      name: "Mo",
      role: "maker",
      reviewer: true,
    };
    const c = panel({ me: maker });
    expect(c.querySelectorAll('[role="switch"]')).toHaveLength(0);
    expectNoForbiddenWords(c);
  });

  it("an org Studio says the list is the members it has seen", () => {
    const c = panel({ limited: true });
    expect(c.textContent).toContain(
      "This Studio sees the members who have opened it. The organisation's full member list isn't available here.",
    );
    expectNoForbiddenWords(c);
  });

  it("access unavailable shows the message, not an empty panel", () => {
    const c = panel({ unavailable: true, members: [] });
    expect(c.textContent).toContain("The team isn't available right now.");
    expect(c.querySelectorAll("[data-member]")).toHaveLength(0);
  });

  it("a Studio without a team document says the settings are being set up", () => {
    const c = panel({ teamDocumentId: null });
    expect(c.textContent).toContain(
      "Team settings are still being set up for this Studio.",
    );
    expect(c.querySelectorAll('[role="switch"]')).toHaveLength(0);
  });

  it("speaks German when the Studio does", () => {
    setLanguage("de");
    const c = panel();
    expect(c.querySelector("h2")?.textContent).toBe("Team");
    expect(row(c, MAKER).textContent).toContain("Macher");
    expect(row(c, MAKER).textContent).toContain("Prüfer");
    expect(row(c, VIEWER).textContent).toContain("Betrachter");
    expect(button(c, "Prüfer Vi")).toBeDefined();
    expectNoForbiddenWords(c);
  });
});
