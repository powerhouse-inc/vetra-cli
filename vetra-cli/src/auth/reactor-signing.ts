/**
 * Signed reactor wiring for a **new cloud Studio** (Task 5.SIG, ruling X39).
 *
 * The embedded reactor of a v2-required Studio is built with the owner's
 * Renown signer:
 *
 *   - the agent's client signs every create and write; while the signer has no
 *     user, a write is refused (`SignerNotReadyError`) instead of being sent
 *     unsigned;
 *   - the trust policy admits only the owner's wallet and the keys its Renown
 *     credential delegates to (see `owner-trust.ts`);
 *   - new documents are `v2-required`; the agent never writes a legacy
 *     document (`legacyDocuments: 'refuse'`);
 *   - the drive has no fixed id (a v2 id is derived), so it is found through
 *     the pointer file and created only once the signer can sign. Its id is
 *     recorded on creation, which makes the Studio sticky across restarts.
 *
 * Local Studios and cloud Studios from before the marker get none of this and
 * keep the legacy, unsigned path.
 */
import { readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type {
  DriveConfig,
  ReactorSigningOptions,
  ReactorClientModule,
} from "@powerhousedao/ph-clint";
import type { IRenown, ISigner } from "@renown/sdk/node";
import { getRenown } from "./renown.js";
import { createOwnerTrustPolicy } from "./owner-trust.js";
import { studioStoreDir } from "./studio-mode.js";

/** Pointer to the drive this Studio created (`<workdir>/.ph/vetra`). */
export function studioDrivePointerPath(workdir: string): string {
  return path.join(studioStoreDir(workdir), "studio-drive.json");
}

/** The recorded Studio drive id, if any. */
export function readStudioDrivePointer(workdir: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(studioDrivePointerPath(workdir), "utf8")) as {
      driveId?: unknown;
    };
    return typeof raw.driveId === "string" && raw.driveId ? raw.driveId : undefined;
  } catch {
    return undefined;
  }
}

/** Record the Studio drive id atomically (temp sibling + rename). */
export function writeStudioDrivePointer(
  workdir: string,
  driveId: string,
  now: Date = new Date(),
): void {
  const file = studioDrivePointerPath(workdir);
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${randomBytes(6).toString("hex")}`);
  writeFileSync(
    tmp,
    `${JSON.stringify({ version: 1, driveId, since: now.toISOString() }, null, 2)}\n`,
  );
  renameSync(tmp, file);
}

/** The pointer's drive id, when the document still exists. */
async function resolvePointerDrive(
  client: Pick<ReactorClientModule["client"], "get">,
  workdir: string,
): Promise<string | undefined> {
  const id = readStudioDrivePointer(workdir);
  if (!id) return undefined;
  try {
    await client.get(id);
    return id;
  } catch {
    // A stale pointer (the drive is gone) falls through to creation.
    return undefined;
  }
}

/**
 * Drive config for a v2-required Studio: pointer first, never match an older
 * "Home" by name (that would adopt a legacy drive), create only when the
 * signer can sign, and record the id on creation.
 */
export function cloudStudioDriveConfig(
  workdir: string,
  options: {
    name?: string;
    preferredEditor?: string;
    /** Whether the drive may be created now (the signer can sign). */
    canCreate?: () => boolean;
  } = {},
): DriveConfig {
  return {
    name: options.name ?? "Home",
    ...(options.preferredEditor ? { preferredEditor: options.preferredEditor } : {}),
    matchByName: false,
    resolveId: (client) => resolvePointerDrive(client, workdir),
    canCreate: options.canCreate ?? (() => true),
    onCreated: (id) => writeStudioDrivePointer(workdir, id),
  };
}

export interface StudioSigningInput {
  workdir: string;
  /** The Studio's Renown (R21), the one the browser logs in on. */
  renownUrl: string;
  adminsEnv?: string;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    debug?: (msg: string) => void;
  };
  /** Tests: inject the Renown instance instead of building it from disk. */
  renown?: IRenown;
}

/** The signer is ready once Renown has a user (the owner's delegation). */
export function signerHasUser(signer: { user?: { address?: string } }): boolean {
  return Boolean(signer.user?.address);
}

/**
 * Build the `signing` option for a new cloud Studio, plus the live Renown
 * (the bootstrap trigger listens to the same instance for readiness).
 */
export async function studioReactorSigning(
  input: StudioSigningInput,
): Promise<{ signing: ReactorSigningOptions; renown: IRenown }> {
  const renown =
    input.renown ?? (await getRenown(input.workdir, input.renownUrl));
  const signer = renown.signer as unknown as ReactorSigningOptions["signer"];
  const trustPolicy = createOwnerTrustPolicy({
    renownUrl: input.renownUrl,
    ownSigner: signer as never,
    adminsEnv: input.adminsEnv,
  });
  const signing: ReactorSigningOptions = {
    signer,
    trustPolicy,
    createSignaturePolicy: "v2-required",
    // A new Studio never has legacy documents, and never writes one unsigned.
    legacyDocuments: "refuse",
    onSignerChange: (listener) => renown.on("user", () => listener()),
  };
  input.log?.info?.(
    "[signing] this Studio creates its drive and documents v2-required; the agent writes only when its Renown signer has the owner's delegation.",
  );
  return { signing, renown };
}

/** The live signer for readiness checks (no reactor build). */
export function signerOf(renown: IRenown): ISigner {
  return renown.signer;
}

export type { IRenown };
