import { readFileSync } from "node:fs";
import { listSpecDocumentTypes } from "@powerhousedao/vetra/codegen/spec";
import { describe, expect, it } from "vitest";
import { documentModels as vetraAppModels } from "./document-models/document-models.js";

type ModelModule = { documentModel: { global: { id: string } } };
type PackageConfig = { packageName: string; provider?: string };

const config = JSON.parse(
  readFileSync(new URL("./powerhouse.config.json", import.meta.url), "utf8"),
) as { packages: PackageConfig[] };

/** Connect registers this package as "Common" in every build (untyped). */
const CONNECT_COMMON_PACKAGE: string =
  "@powerhousedao/powerhouse-vetra-packages";

async function packageModels(name: string): Promise<readonly ModelModule[]> {
  const mod = (await import(name)) as {
    documentModels?: readonly ModelModule[];
  };
  return mod.documentModels ?? [];
}

const ids = (models: readonly ModelModule[]) =>
  models.map((m) => m.documentModel.global.id);

/** Document types the outer Studio Connect can resolve without the registry:
 * Connect's built-in Common package, the bundled `provider: "local"` packages
 * from powerhouse.config.json, and vetra-app's own models. */
async function studioConnectTypes(): Promise<Set<string>> {
  const types = new Set([
    ...ids(await packageModels(CONNECT_COMMON_PACKAGE)),
    ...ids(vetraAppModels),
  ]);
  for (const pkg of config.packages.filter((p) => p.provider === "local")) {
    for (const id of ids(await packageModels(pkg.packageName))) types.add(id);
  }
  return types;
}

describe("Studio Connect document models", () => {
  // The agent writes project specs (document-model, document-editor, app, …)
  // into the Studio drive. The outer Connect syncs that drive; a type it can't
  // load surfaces as "1 document type couldn't load (missing model)".
  it("loads every spec type the agent writes into the Studio drive", async () => {
    const available = await studioConnectTypes();
    const missing = [
      ...listSpecDocumentTypes(),
      ...ids(vetraAppModels as readonly ModelModule[]),
    ].filter((type) => !available.has(type));
    expect(missing).toEqual([]);
  });
});
