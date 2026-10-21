// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnderstoodDraft } from "../../../shared/understood-draft.js";
import { setLanguage } from "../i18n/useT.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import {
  button,
  click,
  pressKey,
  render,
  typeInto,
} from "../test-utils/render.js";
import { defectDraft } from "../test-utils/understoodFixtures.js";
import { UnderstoodView, type UnderstoodNote } from "./UnderstoodView.js";

afterEach(() => {
  setLanguage(null);
});

function view(notes: UnderstoodNote[] = [], draft = defectDraft()) {
  const onChange = vi.fn<(d: UnderstoodDraft) => void>();
  const onBuild = vi.fn<(d: UnderstoodDraft) => void>();
  const onBack = vi.fn();
  const container = render(
    <UnderstoodView
      draft={draft}
      notes={notes}
      onChange={onChange}
      onBuild={onBuild}
      onBack={onBack}
    />,
  );
  const latest = (): UnderstoodDraft => {
    const call = onChange.mock.calls.at(-1);
    if (!call) throw new Error("onChange was never called");
    return call[0];
  };
  return { container, onChange, onBuild, onBack, latest };
}

/** The button whose own text is exactly `text`. */
function exact(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent.trim() === text,
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

function card(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-thing-id="${id}"]`);
  if (!el) throw new Error(`no card ${id}`);
  return el;
}

function choose(select: Element | null, value: string): void {
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  act(() => {
    Reflect.set(HTMLSelectElement.prototype, "value", value, select);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("UnderstoodView", () => {
  it("shows the picture: heading, summary, cards, links, steps, still open", () => {
    const { container } = view();
    expect(container.querySelector("h1")?.textContent).toBe(
      "What I understood",
    );
    expect(container.textContent).toContain(defectDraft().summary);
    expect(container.querySelectorAll("[data-thing-id]")).toHaveLength(4);
    expect(container.querySelectorAll("[data-step-id]")).toHaveLength(5);
    expect(container.textContent).toContain("from Mängelliste");
    expect(container.textContent).toContain("Still open");
    expect(container.textContent).toContain("Gibt es Fristen je Gewerk?");
    expect(button(container, "+ Thing to keep track of")).toBeDefined();
    expect(button(container, "+ Field")).toBeDefined();
    expect(button(container, "+ Step")).toBeDefined();
    // No paragraph is longer than the summary.
    const longest = Math.max(
      ...Array.from(container.querySelectorAll("p")).map(
        (p) => p.textContent.length,
      ),
    );
    expect(longest).toBeLessThanOrEqual(defectDraft().summary.length);
  });

  it("renaming a card updates the draft", () => {
    const { container, latest } = view();
    click(exact(container, "Mangel"));
    const input = container.querySelector('input[aria-label="Mangel"]');
    typeInto(input, "Baumangel");
    pressKey(input as Element, "Enter");
    expect(latest().things[0].name).toBe("Baumangel");
    expect(exact(container, "Baumangel")).toBeDefined();
  });

  it("changing a field type uses the short list", () => {
    const { container, latest } = view();
    const select = container.querySelector(
      'select[aria-label="Kind of Titel"]',
    );
    expect(
      Array.from(select?.querySelectorAll("option") ?? []).map(
        (o) => o.textContent,
      ),
    ).toEqual([
      "Text",
      "Number",
      "Date",
      "Yes / no",
      "Choice",
      "Person",
      "Photo",
      "Place",
    ]);
    choose(select, "date");
    expect(latest().things[0].fields[0].type).toBe("date");
  });

  it("adds and removes a field", () => {
    const { container, latest } = view();
    click(button(card(container, "t-site"), "+ Field"));
    expect(latest().things[1].fields.at(-1)?.name).toBe("New field");
    click(button(card(container, "t-site"), "Remove Aktiv"));
    expect(latest().things[1].fields.map((f) => f.name)).not.toContain("Aktiv");
  });

  it("merge combines two cards", () => {
    const { container, latest } = view();
    click(button(container, "More for Baustelle"));
    click(button(container, "Merge with…"));
    click(exact(card(container, "t-site"), "Nachunternehmer"));
    const draft = latest();
    expect(draft.things.map((t) => t.name)).toEqual([
      "Mangel",
      "Baustelle",
      "Abnahme",
    ]);
    expect(draft.things[1].fields).toHaveLength(16);
    expect(draft.links).toEqual([
      { from: "t-defect", to: "t-site", label: "liegt auf" },
      { from: "t-defect", to: "t-site", label: "zugewiesen an" },
    ]);
  });

  it("split moves the chosen fields onto a new card", () => {
    const { container, latest } = view();
    click(button(container, "More for Abnahme"));
    click(button(container, "Split…"));
    const menu = card(container, "t-check");
    for (const name of ["Kosten", "Freigegeben"]) {
      const box = Array.from(menu.querySelectorAll("label"))
        .find((l) => l.textContent === name)
        ?.querySelector("input");
      click(box);
    }
    typeInto(
      menu.querySelector('input[aria-label="Name of the new thing"]'),
      "Rechnung",
    );
    click(button(menu, "Split off"));
    const draft = latest();
    expect(draft.things.map((t) => t.name)).toContain("Rechnung");
    expect(draft.things.at(-1)?.fields.map((f) => f.name)).toEqual([
      "Kosten",
      "Freigegeben",
    ]);
    expect(draft.things[3].fields).toHaveLength(6);
  });

  it("reordering steps by keyboard", () => {
    const { container, latest } = view();
    const first = container.querySelector('[data-step-id="st1"]');
    pressKey(first as Element, "ArrowRight");
    expect(latest().steps.map((s) => s.id)).toEqual([
      "st2",
      "st1",
      "st3",
      "st4",
      "st5",
    ]);
    click(button(container, "Move Abrechnen earlier"));
    expect(
      latest()
        .steps.map((s) => s.id)
        .at(-2),
    ).toBe("st5");
    // The step's role is a select of the roles.
    choose(
      container.querySelector('select[aria-label="Who does Zuweisen"]'),
      "r-sub",
    );
    expect(latest().steps.find((s) => s.id === "st2")?.roleId).toBe("r-sub");
    click(button(container, "+ Step"));
    expect(latest().steps.at(-1)?.name).toBe("New step");
  });

  it("remove then undo restores", () => {
    const { container, latest } = view();
    click(button(container, "More for Baustelle"));
    click(exact(container, "Remove"));
    expect(container.querySelector('[data-thing-id="t-site"]')).toBeNull();
    expect(latest().links).toHaveLength(1);
    click(button(container, "Undo"));
    expect(container.querySelector('[data-thing-id="t-site"]')).not.toBeNull();
    expect(latest().links).toHaveLength(2);
    // Ctrl-Z does the same.
    click(button(container, "More for Abnahme"));
    click(exact(container, "Remove"));
    expect(latest().things).toHaveLength(3);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
      );
    });
    expect(latest().things).toHaveLength(4);
  });

  it("failed-input note is shown, other cards render", () => {
    const { container } = view([
      { materialId: "mat-photo", text: "This photo is too blurry to read." },
    ]);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("ablauf.jpg");
    expect(alert?.textContent).toContain("This photo is too blurry to read.");
    expect(container.querySelectorAll("[data-thing-id]")).toHaveLength(4);
  });

  it("Build this hands over the corrected draft", () => {
    const { container, onBuild, onBack } = view();
    click(button(container, "More for Abnahme"));
    click(exact(container, "Remove"));
    click(button(container, "Build this"));
    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(onBuild.mock.calls[0][0].things.map((t) => t.id)).toEqual([
      "t-defect",
      "t-site",
      "t-sub",
    ]);
    click(button(container, "Back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("German labels when the language is German", () => {
    setLanguage("de");
    const { container } = view();
    expect(container.querySelector("h1")?.textContent).toBe(
      "Was ich verstanden habe",
    );
    expect(button(container, "So bauen")).toBeDefined();
    expect(button(container, "Zurück")).toBeDefined();
    expect(button(container, "+ Feld")).toBeDefined();
    expect(button(container, "+ Schritt")).toBeDefined();
    expect(container.textContent).toContain("aus Mängelliste");
    expect(container.textContent).toContain("Noch offen");
    const select = container.querySelector(
      'select[aria-label="Art von Titel"]',
    );
    expect(
      Array.from(select?.querySelectorAll("option") ?? []).map(
        (o) => o.textContent,
      ),
    ).toEqual([
      "Text",
      "Zahl",
      "Datum",
      "Ja / Nein",
      "Auswahl",
      "Person",
      "Foto",
      "Ort",
    ]);
    click(button(container, "Mehr zu Baustelle"));
    expect(button(container, "Zusammenführen mit…")).toBeDefined();
    expect(button(container, "Aufteilen…")).toBeDefined();
    expect(exact(container, "Entfernen")).toBeDefined();
  });

  it("never shows a forbidden word, in either language", () => {
    for (const lang of ["en", "de"] as const) {
      setLanguage(lang);
      const { container } = view([
        { materialId: "mat-sheet", text: "One sheet was empty." },
      ]);
      click(
        button(container, lang === "en" ? "More for Mangel" : "Mehr zu Mangel"),
      );
      expectNoForbiddenWords(container);
    }
  });
});
