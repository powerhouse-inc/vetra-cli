import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

// A prod studio: the agent wrote the prod switchboard into studio.config.json.
vi.mock("../hooks/preview-server-client.js", () => ({
  resolveStudioCloudSwitchboardUrl: vi.fn(
    async () => "https://switchboard.vetra.io",
  ),
}));

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("cloud endpoint", () => {
  it("talks to the switchboard from studio.config.json, not the staging default", async () => {
    const { resolveCloudGraphqlEndpoint } = await import("./cloudClient.js");
    expect(await resolveCloudGraphqlEndpoint()).toBe(
      "https://switchboard.vetra.io/graphql",
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: { vetraCloudEnvironments: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { fetchMyEnvironments } = await import("./cloudGraphql.js");
    await fetchMyEnvironments("MINE", "token").catch(() => undefined);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://switchboard.vetra.io/graphql",
    );
  });
});
