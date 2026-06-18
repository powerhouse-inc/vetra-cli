import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { fetchMyEnvironments } from "@powerhousedao/vetra-cloud-client";

const ENDPOINT = "https://switchboard.example/graphql";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe("fetchMyEnvironments", () => {
  it("posts the scope variable + bearer token and returns myEnvironments", async () => {
    const envs = [
      {
        id: "1",
        name: "A",
        subdomain: "a",
        customDomain: null,
        status: "READY",
        owner: "0x1",
        createdBy: null,
      },
    ];
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ data: { myEnvironments: envs } }),
    }));
    global.fetch = fetchMock as never;

    const result = await fetchMyEnvironments(ENDPOINT, "MINE", "tok");
    expect(result).toEqual(envs);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    const body = JSON.parse(init.body as string) as {
      variables: unknown;
    };
    expect(body.variables).toEqual({ scope: "MINE" });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
  });

  it("surfaces the first GraphQL error message", async () => {
    global.fetch = (async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ errors: [{ message: "nope" }] }),
    })) as never;
    await expect(fetchMyEnvironments(ENDPOINT, "MINE", "tok")).rejects.toThrow(
      "nope",
    );
  });

  it("throws on a non-ok HTTP response", async () => {
    global.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
    })) as never;
    await expect(fetchMyEnvironments(ENDPOINT, "MINE", null)).rejects.toThrow(
      /401/,
    );
  });
});
