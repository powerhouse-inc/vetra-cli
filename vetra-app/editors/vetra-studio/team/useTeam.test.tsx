// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test-utils/render.js";
import { useTeam } from "./useTeam.js";

const hoisted = vi.hoisted(() => ({
  fail: false,
  me: {},
  roster: {},
}));

vi.mock("./teamClient.js", () => ({
  fetchTeamMe: () =>
    hoisted.fail
      ? Promise.reject(new Error("404"))
      : Promise.resolve(hoisted.me),
  fetchTeamMembers: () =>
    hoisted.fail
      ? Promise.reject(new Error("404"))
      : Promise.resolve(hoisted.roster),
}));

function Probe() {
  const team = useTeam({ pollMs: 0 });
  return (
    <div
      data-loading={String(team.loading)}
      data-unavailable={String(team.unavailable)}
      data-limited={String(team.limited)}
      data-needs-allow={String(team.needsAllow)}
      data-org={team.orgId ?? ""}
    >
      {team.me?.name ?? ""}|{team.members.map((m) => m.name).join(",")}
    </div>
  );
}

/** The probe element inside the test container. */
function probe(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-loading]");
  if (!el) throw new Error("no probe");
  return el as HTMLElement;
}

beforeEach(() => {
  hoisted.fail = false;
});

describe("useTeam", () => {
  it("reads the caller and the roster the daemon can vouch for", async () => {
    hoisted.me = {
      member: { address: "0xaa", name: "Ada", role: "owner", reviewer: false },
      orgId: "acme",
      needsAllow: true,
    };
    hoisted.roster = {
      orgId: "acme",
      limited: true,
      members: [
        {
          address: "0xaa",
          name: "Ada",
          role: "owner",
          reviewer: false,
          allowedAgent: false,
          overridden: false,
        },
      ],
    };
    const c = render(<Probe />);
    await vi.waitFor(() =>
      expect(probe(c).getAttribute("data-loading")).toBe("false"),
    );
    expect(probe(c).textContent).toBe("Ada|Ada");
    expect(probe(c).getAttribute("data-org")).toBe("acme");
    expect(probe(c).getAttribute("data-limited")).toBe("true");
    expect(probe(c).getAttribute("data-needs-allow")).toBe("true");
    expect(probe(c).getAttribute("data-unavailable")).toBe("false");
  });

  it("is unavailable, not an error page, when the routes cannot answer", async () => {
    hoisted.fail = true;
    const c = render(<Probe />);
    await vi.waitFor(() =>
      expect(probe(c).getAttribute("data-loading")).toBe("false"),
    );
    expect(probe(c).getAttribute("data-unavailable")).toBe("true");
    expect(probe(c).textContent).toBe("|");
  });
});
