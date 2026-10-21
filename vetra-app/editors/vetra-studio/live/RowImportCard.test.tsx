// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportOffer } from "../hooks/workshop-client.js";
import { setLanguage } from "../i18n/useT.js";
import { button, click, render } from "../test-utils/render.js";
import { RowImportCard } from "./RowImportCard.js";

const OFFER: ImportOffer = {
  file: "import/todo-list.json",
  materialName: "pruefliste.xlsx",
  sheet: "Prüfliste",
  documentType: "acme/todo-list",
  rows: 2,
  mapping: [{ column: "Aufgabe", field: "title" }],
  done: 0,
};

beforeEach(() => {
  window.sessionStorage.clear();
  setLanguage("en");
});

describe("RowImportCard", () => {
  it("shows the mapping before anything is imported", () => {
    const container = render(<RowImportCard offer={OFFER} onRun={vi.fn()} />);
    expect(container.textContent).toContain(
      "Bring in your 2 rows from Prüfliste",
    );
    expect(container.textContent).toContain("Aufgabe");
    expect(container.textContent).toContain("title");
    expect(container.textContent).toContain("Bring them in");
  });

  it("Not now hides it for this visit", () => {
    const container = render(<RowImportCard offer={OFFER} onRun={vi.fn()} />);
    click(button(container, "Not now"));
    expect(container.textContent).toBe("");
  });

  it("runs the import and shows the progress", async () => {
    const onRun = vi.fn(() => Promise.resolve({ imported: 1, failed: 0 }));
    const container = render(<RowImportCard offer={OFFER} onRun={onRun} />);
    click(button(container, "Bring them in"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRun).toHaveBeenCalledWith("import/todo-list.json");
    expect(container.textContent).toContain("1 of 2");
  });
});
