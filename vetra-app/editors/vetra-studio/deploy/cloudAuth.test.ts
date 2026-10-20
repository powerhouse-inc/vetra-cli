import { describe, expect, it, vi } from "vitest";

const login = vi.fn();
vi.mock("@powerhousedao/reactor-browser", () => ({
  useRenown: () => null,
  useRenownAuth: () => ({ status: "unauthorized", address: undefined, login }),
}));

describe("useCloudAuth().login", () => {
  it("does not forward the click event to useRenownAuth().login as a wallet session", async () => {
    const { useCloudAuth } = await import("./cloudAuth.js");
    const auth = useCloudAuth();

    // `onClick={auth.login}` hands React's click event to the handler.
    const onClick = auth.login as (event: unknown) => void;
    onClick({ type: "click", target: {} });

    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith();
  });
});
