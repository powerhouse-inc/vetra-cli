/**
 * The cloud-Studio signal and the sticky v2 marker (Task 5.SIG, ruling X39).
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  commitStudioSigningPlan,
  environmentIdOf,
  hasReactorStore,
  isCloudStudio,
  planStudioSigning,
  readSigningMarker,
  reactorStorePath,
  signingMarkerPath,
  writeSigningMarker,
} from "../../src/auth/studio-mode.js";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "studio-mode-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function seedReactorStore(): void {
  mkdirSync(reactorStorePath(workdir), { recursive: true });
}

describe("environmentIdOf", () => {
  it("prefers the config value, trimmed, and falls back to the env", () => {
    expect(environmentIdOf({ environmentId: " env-1 " }, {})).toBe("env-1");
    expect(environmentIdOf({}, { VETRA_ENVIRONMENT_ID: "env-2" })).toBe("env-2");
    expect(environmentIdOf({ environmentId: "  " }, {})).toBeUndefined();
    expect(environmentIdOf(undefined, {})).toBeUndefined();
  });
});

describe("isCloudStudio", () => {
  it("is true with an environment id, false on a local Studio", () => {
    expect(isCloudStudio({ environmentId: "env-1" }, workdir, {})).toBe(true);
    expect(isCloudStudio({}, workdir, {})).toBe(false);
  });

  it("is true when only the sticky marker is left (env id lost)", () => {
    writeSigningMarker(workdir, "env-1");
    expect(isCloudStudio({}, workdir, {})).toBe(true);
  });
});

describe("planStudioSigning", () => {
  it("makes a fresh cloud Studio v2-required", () => {
    const plan = planStudioSigning(workdir, { environmentId: "env-1" }, {});
    expect(plan).toMatchObject({ cloud: true, mode: "v2-required", fresh: true });
  });

  it("keeps a local Studio legacy", () => {
    const plan = planStudioSigning(workdir, {}, {});
    expect(plan).toMatchObject({ cloud: false, mode: "legacy", fresh: false });
  });

  it("keeps an existing cloud Studio (reactor store present) legacy — 2b migrates it", () => {
    seedReactorStore();
    const plan = planStudioSigning(workdir, { environmentId: "env-1" }, {});
    expect(plan).toMatchObject({ cloud: true, mode: "legacy", fresh: false });
    expect(readSigningMarker(workdir)).toBeUndefined();
  });

  it("is sticky: once v2, a restart without the env id stays v2", () => {
    const fresh = planStudioSigning(workdir, { environmentId: "env-1" }, {});
    commitStudioSigningPlan(workdir, fresh);
    expect(readSigningMarker(workdir)?.mode).toBe("v2-required");

    seedReactorStore(); // the drive now exists
    const restart = planStudioSigning(workdir, {}, {});
    expect(restart).toMatchObject({ cloud: true, mode: "v2-required", fresh: false });
  });

  it("writes the marker before anything is created (fresh flag only once)", () => {
    const plan = planStudioSigning(workdir, { environmentId: "env-1" }, {});
    commitStudioSigningPlan(workdir, plan);
    expect(planStudioSigning(workdir, { environmentId: "env-1" }, {}).fresh).toBe(false);
  });

  it("treats an unreadable marker as v2, never downgrading a signed Studio", () => {
    mkdirSync(path.dirname(signingMarkerPath(workdir)), { recursive: true });
    writeFileSync(signingMarkerPath(workdir), "{not json");
    expect(readSigningMarker(workdir)?.mode).toBe("v2-required");
    expect(planStudioSigning(workdir, {}, {}).mode).toBe("v2-required");
  });

  it("writes the marker atomically", () => {
    const marker = writeSigningMarker(workdir, "env-1");
    const onDisk = JSON.parse(readFileSync(signingMarkerPath(workdir), "utf8"));
    expect(onDisk).toEqual(marker);
    expect(marker.since).toMatch(/^\d{4}-/);
    expect(hasReactorStore(workdir)).toBe(false);
  });
});
