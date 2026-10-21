// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "../test-utils/render.js";
import { resetLanguageStore, setLanguage, useT } from "./useT.js";

function Heading({ id }: { id: string }) {
  const { t } = useT();
  return <p id={id}>{t("idea.heading")}</p>;
}

beforeEach(() => {
  window.localStorage.clear();
  resetLanguageStore();
});

describe("useT", () => {
  it("works without a provider and defaults to English", () => {
    const c = render(<Heading id="a" />);
    expect(c.textContent).toBe("What do you want to build?");
  });
  it("re-renders every mounted component on change", () => {
    const a = render(<Heading id="a" />);
    const b = render(<Heading id="b" />);
    act(() => setLanguage("de"));
    expect(a.textContent).toBe("Was möchtest du bauen?");
    expect(b.textContent).toBe("Was möchtest du bauen?");
    expect(document.documentElement.lang).toBe("de");
    act(() => setLanguage("en"));
    expect(a.textContent).toBe("What do you want to build?");
    expect(document.documentElement.lang).toBe("en");
  });
});
