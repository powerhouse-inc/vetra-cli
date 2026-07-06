import { describe, it, expect } from "@jest/globals";
import { isBareLaunchArgs, resolveWorkdir } from "../src/setup-auth.js";

// isBareLaunchArgs takes full argv (it slices the node + script tokens).
const argv = (...rest: string[]) => ["node", "vetra", ...rest];

describe("isBareLaunchArgs", () => {
  it.each([
    [[], "bare vetra"],
    [["-i"], "vetra -i"],
    [["--interactive"], "vetra --interactive"],
    [["--workdir", "/x"], "vetra --workdir /x (value skipped)"],
    [["-w", "/x", "-i"], "vetra -w /x -i"],
    [["--verbose"], "vetra --verbose"],
    [["--resume", "abc"], "vetra --resume abc (value skipped)"],
  ])("treats %j as a bare launch (%s)", (rest) => {
    expect(isBareLaunchArgs(argv(...rest))).toBe(true);
  });

  it.each([
    [["claude-login"], "subcommand"],
    [["reactor-project-init", "foo"], "subcommand + arg"],
    [["--version"], "--version"],
    [["-V"], "-V"],
    [["--help"], "--help"],
    [["-h"], "-h"],
    [["--config", "f.json"], "explicit --config"],
    [["-c", "f.json"], "explicit -c"],
    [["--meta"], "--meta"],
  ])("treats %j as one-shot / opt-out (%s)", (rest) => {
    expect(isBareLaunchArgs(argv(...rest))).toBe(false);
  });
});

describe("resolveWorkdir", () => {
  it("returns cwd when no --workdir is given", () => {
    expect(resolveWorkdir(argv())).toBe(process.cwd());
    expect(resolveWorkdir(argv("-i"))).toBe(process.cwd());
  });

  it("returns the --workdir / -w value", () => {
    expect(resolveWorkdir(argv("--workdir", "/proj"))).toBe("/proj");
    expect(resolveWorkdir(argv("-w", "/proj"))).toBe("/proj");
  });
});
