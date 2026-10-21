// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkshopClientError,
  type MaterialCard,
} from "../hooks/workshop-client.js";
import { setLanguage } from "../i18n/useT.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import { MaterialDrop } from "./MaterialDrop.js";

const upload = vi.hoisted(() => vi.fn());
vi.mock("../hooks/workshop-client.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uploadMaterial: upload,
}));

const SHEET: MaterialCard = {
  id: "m1",
  name: "orders.csv",
  kind: "SHEET",
  sheets: [{ sheet: "orders", header: ["a", "b"], rowCount: 42 }],
};

beforeEach(() => {
  upload.mockReset();
  window.localStorage.clear();
  setLanguage("en");
});

function file(name: string, type = "text/csv"): File {
  return new File(["x"], name, { type });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function drop(container: HTMLElement, files: File[]): void {
  const root = container.firstElementChild as HTMLElement;
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types: ["Files"], items: [] },
  });
  act(() => {
    root.dispatchEvent(event);
  });
}

function paste(container: HTMLElement, files: File[]): void {
  const root = container.firstElementChild as HTMLElement;
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  act(() => {
    root.dispatchEvent(event);
  });
}

function mount(props: Partial<Parameters<typeof MaterialDrop>[0]> = {}) {
  const onCards = vi.fn();
  const container = render(<MaterialDrop onCards={onCards} {...props} />);
  return { container, onCards };
}

describe("MaterialDrop", () => {
  it("the notice is shown before any upload", () => {
    const { container } = mount();
    expect(container.textContent).toContain(
      "Your files are read by the AI model this Studio uses.",
    );
    expect(button(container, "Add a diagram, photo or sheet")).toBeDefined();
  });

  it("dropping a sheet uploads it and shows its rows", async () => {
    upload.mockResolvedValue(SHEET);
    const { container, onCards } = mount();
    drop(container, [file("orders.csv")]);
    await flush();
    expect(container.textContent).toContain("orders.csv");
    expect(container.textContent).toContain("42 rows");
    expect(onCards).toHaveBeenLastCalledWith([SHEET]);
  });

  it("one row is one row, in English and German", async () => {
    const one: MaterialCard = {
      ...SHEET,
      sheets: [{ sheet: "orders", header: ["a"], rowCount: 1 }],
    };
    upload.mockResolvedValue(one);
    const { container } = mount();
    drop(container, [file("orders.csv")]);
    await flush();
    expect(container.textContent).toContain("1 row");
    expect(container.textContent).not.toContain("1 rows");
    act(() => setLanguage("de"));
    expect(container.textContent).toContain("1 Zeile");
    expect(container.textContent).not.toContain("1 Zeilen");
  });

  it("a too-large file shows its own error and keeps the others", async () => {
    upload.mockImplementation((f: File) =>
      f.name === "big.pdf"
        ? Promise.reject(new WorkshopClientError("too-large"))
        : Promise.resolve(SHEET),
    );
    const { container, onCards } = mount();
    drop(container, [file("big.pdf", "application/pdf"), file("orders.csv")]);
    await flush();
    expect(container.textContent).toContain("That file is larger than 15 MB.");
    expect(container.textContent).toContain("42 rows");
    expect(onCards).toHaveBeenLastCalledWith([SHEET]);
  });

  it("an unreadable kind of file says so", async () => {
    upload.mockRejectedValue(new WorkshopClientError("unsupported"));
    const { container } = mount();
    drop(container, [file("a.txt", "text/plain")]);
    await flush();
    expect(container.textContent).toContain(
      "This kind of file can't be read yet.",
    );
  });

  it("paste of a picture adds it", async () => {
    upload.mockResolvedValue({ id: "p1", name: "pasted.png", kind: "PICTURE" });
    const { container, onCards } = mount();
    paste(container, [file("pasted.png", "image/png")]);
    await flush();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onCards).toHaveBeenLastCalledWith([
      { id: "p1", name: "pasted.png", kind: "PICTURE" },
    ]);
  });

  it("removing a chip drops the file", async () => {
    upload.mockResolvedValue(SHEET);
    const { container, onCards } = mount();
    drop(container, [file("orders.csv")]);
    await flush();
    click(button(container, "Remove orders.csv"));
    expect(onCards).toHaveBeenLastCalledWith([]);
  });

  it("signed out, a drop asks to sign in and uploads nothing", () => {
    const onSignInNeeded = vi.fn();
    const { container } = mount({ signedIn: false, onSignInNeeded });
    drop(container, [file("orders.csv")]);
    expect(upload).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Sign in to add files");
    expect(onSignInNeeded).toHaveBeenCalled();
  });

  it("speaks German and never uses a forbidden word", async () => {
    upload.mockRejectedValue(new WorkshopClientError("unsupported"));
    for (const lang of ["en", "de"] as const) {
      setLanguage(lang);
      const { container } = mount();
      expectNoForbiddenWords(container);
      drop(container, [file("a.txt", "text/plain")]);
      await flush();
      expectNoForbiddenWords(container);
    }
    setLanguage("de");
    const { container } = mount();
    expect(container.textContent).toContain(
      "Deine Dateien werden vom KI-Modell dieses Studios gelesen.",
    );
  });
});
