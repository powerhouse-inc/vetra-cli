/**
 * Where the Cli keeps the files it writes on its own account in the project
 * (its workdir): all under `.ph/vetra/`, the folder the Studio switchboard's
 * stores (host data) and clint's store (`.mastra`, `logs`) already use. None
 * lands at `.ph/` root, where the switchboard keeps its instance key
 * (`.keypair.json`) and the store its pseudonym (`.pseudonym.json`), nor
 * anywhere else in the project.
 *
 * The paths are relative to the workdir; `studioPath` joins one to it.
 */
import path from "node:path";
import { CLI_NAME } from "../config.js";

/** The Cli's folder in the project: `.ph/vetra`. */
export const STUDIO_DIR = path.join(".ph", CLI_NAME);

/** Every file and folder the Cli writes under {@link STUDIO_DIR}. */
export const STUDIO_FILES = {
  /** The agent's Renown keypair (its `did:key`). */
  agentKeypair: path.join(STUDIO_DIR, "agent", ".keypair.json"),
  /** The credential the owner delegated to the agent. */
  agentRenown: path.join(STUDIO_DIR, "agent", ".renown.json"),
  /** Owner keys the local API's gate verified recently. */
  trustedKeys: path.join(STUDIO_DIR, "preview-trusted-keys.json"),
  /** The codegen lock (`spec-generate` across processes). */
  codegenLock: path.join(STUDIO_DIR, "codegen.lock"),
  /** Who started the launch in flight. */
  launchRecord: path.join(STUDIO_DIR, "launch.json"),
  /** The live product drive's set-up state. */
  productDriveMarker: path.join(STUDIO_DIR, "product-drive.json"),
  /** The path the first version of an adopted product took. */
  upgradeRecord: path.join(STUDIO_DIR, "upgrade-existing.json"),
  /** What the Preview run loaded; its switchboard's inspector writes it. */
  previewInspector: path.join(STUDIO_DIR, "preview", "inspector.json"),
  /** The model specification documents the Cli made from the Preview's report. */
  runtimeSpecs: path.join(STUDIO_DIR, "runtime-specs.json"),
  /** Files extracted from chat messages for the agent. */
  downloads: path.join(STUDIO_DIR, "downloads"),
} as const;

export type StudioFile = keyof typeof STUDIO_FILES;

/** The absolute path of a Cli file in `workdir`. */
export function studioPath(workdir: string, file: StudioFile): string {
  return path.join(workdir, STUDIO_FILES[file]);
}
