import { renderToStaticMarkup } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { BudgetMeter, StripBudget } from "./BudgetMeter.js";
import { budgetFailureAction } from "./BudgetFailureAction.js";
import {
  fetchStudioLlmUsage,
  requestMoreBudget,
  type StudioLlmUsage,
} from "./budgetClient.js";
import {
  budgetView,
  createBudgetStore,
  type BudgetDeps,
  type BudgetSnapshot,
} from "./budgetStore.js";

vi.mock("../hooks/preview-server-client.js", () => ({
  resolveStudioCloudSwitchboardUrl: vi.fn(() =>
    Promise.resolve("https://switchboard.vetra.io"),
  ),
}));

function bodyText(body: BodyInit | null | undefined): string {
  return typeof body === "string" ? body : "";
}

const NOW = Date.parse("2026-10-19T12:00:00Z");

function usage(usageUsd: number, limitUsd: number | null): StudioLlmUsage {
  return {
    source: "VETRA",
    model: "anthropic/claude-sonnet-4.5",
    usageUsd,
    limitUsd,
    resetsAt: "2026-11-01T00:00:00Z",
  };
}

function snapshot(
  u: StudioLlmUsage | null,
  over: Partial<BudgetSnapshot> = {},
): BudgetSnapshot {
  return {
    environmentId: "env-1",
    usage: u,
    exhaustedByFailure: false,
    request: { kind: "idle" },
    ...over,
  };
}

function meter(s: BudgetSnapshot): string {
  return renderToStaticMarkup(
    <BudgetMeter view={budgetView(s)} onRequest={() => undefined} />,
  );
}

function fakeDeps(over: Partial<BudgetDeps> = {}): BudgetDeps {
  return {
    resolveEnvironmentId: vi.fn(() => Promise.resolve("env-1")),
    getToken: vi.fn(() => Promise.resolve("tok")),
    fetchUsage: vi.fn(() => Promise.resolve(usage(5, 5))),
    requestBudget: vi.fn(() =>
      Promise.resolve({ ok: true as const, recorded: true }),
    ),
    now: () => NOW,
    storage: null,
    ...over,
  };
}

describe("BudgetMeter", () => {
  it("shows used of limit", () => {
    const html = meter(snapshot(usage(1.5, 5)));
    expect(html).toContain("$1.50 of $5.00");
    expect(html).toContain('data-level="ok"');
    expect(html).not.toContain("Request more budget");
  });

  it("warns at 80 percent", () => {
    expect(meter(snapshot(usage(4, 5)))).toContain('data-level="warning"');
    expect(meter(snapshot(usage(3.99, 5)))).toContain('data-level="ok"');
  });

  it("shows request button when exhausted", () => {
    const html = meter(snapshot(usage(5, 5)));
    expect(html).toContain('data-level="exhausted"');
    expect(html).toContain("Budget used up");
    expect(html).toContain("Request more budget");
    // A BUDGET_EXHAUSTED failure exhausts the meter even before usage catches up.
    expect(
      meter(snapshot(usage(4.2, 5), { exhaustedByFailure: true })),
    ).toContain("Request more budget");
  });

  it("shows only the spend when the budget is unlimited, and nothing without a key", () => {
    expect(meter(snapshot(usage(2, null)))).toContain("$2.00 used");
    expect(meter(snapshot(null))).toBe("");
  });
});

function strip(text: string, s: BudgetSnapshot): string {
  return renderToStaticMarkup(
    <StripBudget
      text={text}
      view={budgetView(s)}
      onRequest={() => undefined}
    />,
  );
}

describe("StripBudget", () => {
  it("strip shows $0.31 of $10, amber from 80 percent", () => {
    const ok = strip("$0.31 of $10", snapshot(usage(0.31, 10)));
    expect(ok).toContain("$0.31 of $10");
    expect(ok).toContain('data-level="ok"');
    expect(ok).not.toContain("text-warning");

    const amber = strip("$8.00 of $10", snapshot(usage(8, 10)));
    expect(amber).toContain('data-level="warning"');
    expect(amber).toContain("text-warning");
    expect(amber).toContain(
      "You&#x27;ve used 80% of this month&#x27;s budget.",
    );
    expect(amber).not.toContain("Request more budget");
  });

  it("strip turns red with Request more budget at the limit", () => {
    const red = strip("$10.00 of $10", snapshot(usage(10, 10)));
    expect(red).toContain('data-level="exhausted"');
    expect(red).toContain("text-destructive");
    expect(red).toContain("$10.00 of $10");
    expect(red).toContain("Request more budget");
    // Used up by a failed turn before any usage arrived.
    expect(strip("", snapshot(null, { exhaustedByFailure: true }))).toContain(
      "Budget used up",
    );
    expect(strip("", snapshot(null))).toBe("");
  });
});

describe("budget store", () => {
  it("request calls the mutation once and shows requested", async () => {
    const deps = fakeDeps();
    const store = createBudgetStore(deps);
    await store.refresh();
    await Promise.all([store.request(), store.request()]);
    await store.request();
    expect(deps.requestBudget).toHaveBeenCalledTimes(1);
    expect(deps.requestBudget).toHaveBeenCalledWith("env-1", "tok");
    expect(store.getSnapshot().request.kind).toBe("requested");
    const html = meter(store.getSnapshot());
    expect(html).toContain("Requested — we&#x27;ll raise it soon");
    expect(html).not.toContain("Request more budget");
  });

  it("treats an already-open request (false) as requested, not an error", async () => {
    const deps = fakeDeps({
      requestBudget: vi.fn(() =>
        Promise.resolve({ ok: true as const, recorded: false }),
      ),
    });
    const store = createBudgetStore(deps);
    await store.refresh();
    await store.request();
    expect(store.getSnapshot().request.kind).toBe("requested");
  });

  it("remembers a request for 24 hours", async () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v),
    };
    const first = createBudgetStore(fakeDeps({ storage }));
    await first.refresh();
    await first.request();

    const later = fakeDeps({ storage, now: () => NOW + 23 * 3600_000 });
    const second = createBudgetStore(later);
    await second.refresh();
    expect(second.getSnapshot().request.kind).toBe("requested");
    await second.request();
    expect(later.requestBudget).not.toHaveBeenCalled();

    const nextDay = fakeDeps({ storage, now: () => NOW + 25 * 3600_000 });
    const third = createBudgetStore(nextDay);
    await third.refresh();
    expect(third.getSnapshot().request.kind).toBe("idle");
  });

  it("shows a readable message when the request fails, and allows a retry", async () => {
    const requestBudget = vi
      .fn<BudgetDeps["requestBudget"]>()
      .mockResolvedValueOnce({
        ok: false,
        message: "Only the Studio's operators can request more budget.",
      })
      .mockResolvedValueOnce({ ok: true, recorded: true });
    const store = createBudgetStore(fakeDeps({ requestBudget }));
    await store.refresh();
    await store.request();
    const html = meter(store.getSnapshot());
    expect(html).toContain("operators can request more budget");
    expect(html).not.toContain("[object Object]");
    expect(html).toContain("Request more budget");
    await store.request();
    expect(store.getSnapshot().request.kind).toBe("requested");
  });

  it("a recent BUDGET_EXHAUSTED failure exhausts the meter until the limit is raised", async () => {
    let current = usage(4.2, 5);
    const store = createBudgetStore(
      fakeDeps({ fetchUsage: vi.fn(() => Promise.resolve(current)) }),
    );
    await store.refresh();
    store.markExhausted("2026-10-19T11:59:00Z");
    expect(budgetView(store.getSnapshot())?.level).toBe("exhausted");
    // An old failure in the history does not.
    const other = createBudgetStore(
      fakeDeps({ fetchUsage: vi.fn(() => Promise.resolve(current)) }),
    );
    await other.refresh();
    other.markExhausted("2026-10-01T00:00:00Z");
    expect(budgetView(other.getSnapshot())?.level).toBe("warning");

    current = usage(4.2, 20);
    await store.refresh();
    expect(budgetView(store.getSnapshot())?.level).toBe("ok");
  });
});

describe("budget store review fixes", () => {
  it("hides the meter after sign-out", async () => {
    let token: string | null = "tok";
    const store = createBudgetStore(
      fakeDeps({
        getToken: vi.fn(() => Promise.resolve(token)),
        fetchUsage: vi.fn(() => Promise.resolve(usage(1, 5))),
      }),
    );
    await store.refresh();
    expect(budgetView(store.getSnapshot())).not.toBeNull();
    token = null;
    await store.refresh();
    expect(store.getSnapshot().usage).toBeNull();
    expect(meter(store.getSnapshot())).toBe("");
  });

  it("used-up clears after a monthly reset", async () => {
    let now = NOW;
    let current = usage(5, 5);
    const store = createBudgetStore(
      fakeDeps({
        now: () => now,
        fetchUsage: vi.fn(() => Promise.resolve(current)),
      }),
    );
    await store.refresh();
    store.markExhausted(new Date(NOW - 30_000).toISOString());
    // A poll inside the cloud's 60 s usage cache may still show stale spend.
    current = usage(4.9, 5);
    await store.refresh();
    expect(budgetView(store.getSnapshot())?.level).toBe("exhausted");
    // The month rolled over: a fresh poll shows spend below the same limit.
    now = NOW + 5 * 60_000;
    current = usage(0.1, 5);
    await store.refresh();
    expect(budgetView(store.getSnapshot())?.level).toBe("ok");

    // Failure while the limit was unknown/unlimited (failureLimit null).
    let now2 = NOW;
    let current2 = usage(3, null);
    const other = createBudgetStore(
      fakeDeps({
        now: () => now2,
        fetchUsage: vi.fn(() => Promise.resolve(current2)),
      }),
    );
    await other.refresh();
    other.markExhausted(new Date(NOW - 30_000).toISOString());
    expect(budgetView(other.getSnapshot())?.level).toBe("exhausted");
    now2 = NOW + 5 * 60_000;
    current2 = usage(0.2, 5);
    await other.refresh();
    expect(budgetView(other.getSnapshot())?.level).toBe("ok");
  });
});

describe("chat failure action", () => {
  it("chat failure action renders request for BUDGET_EXHAUSTED", () => {
    const budget = {
      snapshot: snapshot(usage(5, 5)),
      request: vi.fn(),
      markExhausted: vi.fn(),
    };
    const failure = {
      code: "BUDGET_EXHAUSTED",
      failedAt: "2026-10-19T11:59:00Z",
      message: "Budget used up",
      retryable: true,
      userMessageId: "m1",
    };
    const html = renderToStaticMarkup(
      <>{budgetFailureAction(failure, budget)}</>,
    );
    expect(html).toContain("Request more budget");

    const requested = {
      ...budget,
      snapshot: snapshot(usage(5, 5), {
        request: { kind: "requested", at: NOW },
      }),
    };
    expect(
      renderToStaticMarkup(<>{budgetFailureAction(failure, requested)}</>),
    ).toContain("Requested — we&#x27;ll raise it soon");

    expect(
      budgetFailureAction({ ...failure, code: "RATE_LIMITED" }, budget),
    ).toBeNull();
  });
});

describe("budget client", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("queries studioLlmUsage for the environment with the bearer token", async () => {
    fetchSpy.mockResolvedValueOnce(
      ok({ data: { vetraLlm: { studioLlmUsage: usage(1, 5) } } }),
    );
    await expect(fetchStudioLlmUsage("env-1", "tok")).resolves.toEqual(
      usage(1, 5),
    );
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://switchboard.vetra.io/graphql");
    const body = JSON.parse(bodyText(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(body.query).toContain(
      "studioLlmUsage(environmentId: $environmentId)",
    );
    expect(body.variables).toEqual({ environmentId: "env-1" });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("returns null usage on failure", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ errors: [{ message: "boom" }] }));
    await expect(fetchStudioLlmUsage("env-1", "tok")).resolves.toBeNull();
  });

  it("requestMoreBudget maps true/false and GraphQL errors", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        ok({ data: { vetraLlm: { requestStudioLlmBudget: true } } }),
      )
      .mockResolvedValueOnce(
        ok({ data: { vetraLlm: { requestStudioLlmBudget: false } } }),
      )
      .mockResolvedValueOnce(
        ok({
          errors: [{ message: "Forbidden", extensions: { code: "FORBIDDEN" } }],
        }),
      )
      .mockResolvedValueOnce(
        ok({ errors: [{ message: "Something odd happened" }] }),
      );
    await expect(requestMoreBudget("env-1", "tok")).resolves.toEqual({
      ok: true,
      recorded: true,
    });
    await expect(requestMoreBudget("env-1", "tok")).resolves.toEqual({
      ok: true,
      recorded: false,
    });
    await expect(requestMoreBudget("env-1", "tok")).resolves.toEqual({
      ok: false,
      message: "Only the Studio's operators can request more budget.",
    });
    const odd = await requestMoreBudget("env-1", "tok");
    expect(odd).toEqual({
      ok: false,
      message: "Could not request more budget: Something odd happened",
    });
    const body = JSON.parse(bodyText(fetchSpy.mock.calls[0]?.[1]?.body)) as {
      query: string;
    };
    expect(body.query).toContain(
      "requestStudioLlmBudget(environmentId: $environmentId)",
    );
  });
});
