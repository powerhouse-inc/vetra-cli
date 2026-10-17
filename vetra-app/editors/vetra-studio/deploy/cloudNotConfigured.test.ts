import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

// No switchboard in studio.config.json: never fall back to staging.
vi.mock("../hooks/preview-server-client.js", () => ({
  resolveStudioCloudSwitchboardUrl: vi.fn(async () => null),
}));

let fetchSpy: MockInstance<typeof fetch>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe("cloud endpoint without studio config", () => {
  it("refuses instead of talking to a default switchboard", async () => {
    const { resolveCloudGraphqlEndpoint, CLOUD_NOT_CONFIGURED } =
      await import("./cloudClient.js");
    await expect(resolveCloudGraphqlEndpoint()).rejects.toThrow(
      CLOUD_NOT_CONFIGURED,
    );
    const { fetchMyEnvironments } = await import("./cloudGraphql.js");
    await expect(fetchMyEnvironments("MINE", "token")).rejects.toThrow(
      CLOUD_NOT_CONFIGURED,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
