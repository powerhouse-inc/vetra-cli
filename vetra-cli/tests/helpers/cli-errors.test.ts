import { describe, it, expect } from "@jest/globals";
import {
  formatLines,
  formatProcessFailure,
  requireOption,
  unknownValueError,
} from "../../src/helpers/cli-errors.js";

describe("formatLines", () => {
  it("joins message and hint with a newline", () => {
    expect(formatLines("main", "hint")).toBe("main\nhint");
  });

  it("returns the bare message when hint is undefined", () => {
    expect(formatLines("main", undefined)).toBe("main");
  });

  it("returns the bare message when hint is empty", () => {
    expect(formatLines("main", "")).toBe("main");
  });
});

describe("formatProcessFailure", () => {
  it("carries the message, command, cwd, and captured output", () => {
    const msg = formatProcessFailure(
      "ph init failed",
      "ph init foo --pnpm",
      "/work",
      "sh: 1: ph: not found\n",
    );
    expect(msg).toMatch(/^ph init failed/);
    expect(msg).toMatch(/command: ph init foo --pnpm/);
    expect(msg).toMatch(/cwd: \/work/);
    expect(msg).toMatch(/output:\nsh: 1: ph: not found/);
  });

  it("notes when no output was captured", () => {
    const msg = formatProcessFailure("x", "cmd", "/c", "   \n  ");
    expect(msg).toMatch(/output: \(none captured\)/);
  });

  it("tails output that exceeds the limit", () => {
    const big = "HEAD_MARKER" + "x".repeat(100) + "TAIL_MARKER";
    const msg = formatProcessFailure("x", "cmd", "/c", big, 30);
    expect(msg).toContain("…");
    expect(msg).toContain("TAIL_MARKER");
    expect(msg).not.toContain("HEAD_MARKER");
  });
});

describe("requireOption", () => {
  it("does nothing for a non-empty value", () => {
    expect(() => requireOption("ok", "name")).not.toThrow();
  });

  it("throws with the flag name when value is empty", () => {
    expect(() => requireOption("", "name")).toThrow(
      /Missing required option --name\./,
    );
  });

  it("appends a hint on a new line when supplied", () => {
    expect(() => requireOption("", "type", "Available: foo, bar")).toThrow(
      /Missing required option --type\.\nAvailable: foo, bar/,
    );
  });
});

describe("unknownValueError", () => {
  it("produces a single line when no candidates match and no list is configured", () => {
    const err = unknownValueError({
      subject: "spec",
      value: "Nothing",
      candidates: [],
    });
    expect(err.message).toBe('Unknown spec "Nothing".');
  });

  it("inlines a Did-you-mean? line when candidates are close enough", () => {
    const err = unknownValueError({
      subject: "spec",
      value: "Wrkout",
      candidates: ["Workout", "Cardio", "Stretch"],
    });
    expect(err.message).toMatch(/^Unknown spec "Wrkout"\./);
    expect(err.message).toMatch(/Did you mean: Workout(, |\?)/);
  });

  it("emits the full list inline when within inlineLimit", () => {
    const err = unknownValueError({
      subject: "action",
      value: "X",
      candidates: ["A", "B", "C"],
      knownLabel: "Valid actions",
      inlineLimit: 5,
      overflowHint: "Run discovery.",
    });
    expect(err.message).toMatch(/Valid actions: A, B, C/);
    expect(err.message).not.toMatch(/Run discovery/);
  });

  it("falls back to the overflow hint above inlineLimit", () => {
    const err = unknownValueError({
      subject: "action",
      value: "X",
      candidates: Array.from({ length: 20 }, (_, i) => `OP_${i}`),
      knownLabel: "Valid actions",
      inlineLimit: 5,
      overflowHint: "Run `discover`.",
    });
    expect(err.message).toMatch(/Run `discover`\./);
    expect(err.message).not.toMatch(/^Valid actions:/m);
  });

  it("appends the context after the leading line", () => {
    const err = unknownValueError({
      subject: "action",
      value: "SET_X",
      candidates: ["SET_Y"],
      context: "for powerhouse/document-editor",
    });
    expect(err.message).toMatch(
      /^Unknown action "SET_X" for powerhouse\/document-editor\./,
    );
  });
});
