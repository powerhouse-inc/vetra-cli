/**
 * The live product's drive (designer's call D21): at the first launch, one
 * drive on the product's live server, named after the product, owned by the
 * Studio owner, seeded once with the example documents the agent wrote in the
 * Tests step (seed.ts).
 *
 * Every call runs as the owner's delegated identity — the agent's Renown
 * bearer and signer, the same identity the deploy commands use for the cloud
 * drive (`cloud/environments-write.ts`) — so the drive's creator, and with it
 * its owner, is the Studio owner.
 *
 * First-launch order (Ruling F7b): DEPLOY READY → `ensureProductDrive`
 * (create + seed; the models are installed by then) → the orchestrator calls
 * `cloudSetProductDrive` and dispatches `SET_PRODUCT_DRIVE` → VERIFY.
 *
 * Once only: when the product already has a drive (`knownDriveId`, from the
 * product document) nothing is called. A small marker in the workdir records
 * the drive and the example documents already written, so a launch that was
 * interrupted after the drive existed resumes on that drive and never makes a
 * second one.
 *
 * Access (Q3 default `SIGNED_IN`): the drive is left unprotected, so any
 * signed-in Renown user can open and write it; `setAccess(…, 'OWNER_ONLY')`
 * protects it (`setDocumentProtection`). Whether the switchboard lets
 * anonymous visitors read an unprotected drive is the switchboard's policy.
 *
 * Live verification (Task 2.6 Step 1, run on a staging production env): see
 * the task report — drive creation, a second identity writing an unprotected
 * drive, and `setDocumentProtection` by the delegated identity.
 */
import fs from "node:fs";
import type { ISigner } from "document-model";
import path from "node:path";
import { getBearerToken, getRenown } from "../auth/renown.js";
import { resolveCloudConfig } from "../cloud/config.js";
import { redact, type CloudContext } from "./cloud-launch.js";
import { LaunchError } from "./errors.js";
import { validateSeeds, type SeedAction, type SeedDocument } from "./seed.js";

export type ProductAccess = "OWNER_ONLY" | "SIGNED_IN";

/** Q3: anyone with the link, after Renown sign-in. */
export const DEFAULT_ACCESS: ProductAccess = "SIGNED_IN";

/** Plain reasons (the UI prefixes "Couldn't go live:"; F39). */
export const DRIVE_REASONS = {
  create: "your product's data space couldn't be set up",
  access: "who can use your product couldn't be changed",
} as const;

/** The calls on the live server, as the owner's delegated identity. */
export interface ProductDriveClient {
  /** Create an empty drive; returns its id. Kept to one request so a retry can't leave a half-made second drive. */
  createDrive(): Promise<string>;
  /** Name the drive and, when given, open it in the product's app view. Safe to repeat. */
  configureDrive(driveId: string, input: { name: string; preferredEditor?: string }): Promise<void>;
  /** Create one document in the drive, named `name`, and apply `actions` to it in order. */
  addDocument(
    driveId: string,
    doc: { documentType: string; name: string; actions: SeedAction[] },
  ): Promise<string>;
  /** `setDocumentProtection(documentIdOrSlug, protected)`. */
  setProtection(driveId: string, isProtected: boolean): Promise<void>;
}

export interface ProductDriveContext extends CloudContext {
  /** Seam for tests; defaults to the delegated-identity GraphQL client (`createDriveClient`). */
  driveClient?: (switchboardUrl: string) => Promise<ProductDriveClient>;
}

export interface EnsureProductDriveOptions {
  /** The product's live server (base URL or its `/graphql` endpoint). */
  switchboardUrl: string;
  /** The product's name — the drive's name. */
  name: string;
  /** The product's app view, when it has one: the drive's preferred editor. */
  appEditorId?: string | null;
  /** The reactor project(s) holding `seed/*.json` (a workspace's projects ship as one product); no seeding when absent. */
  projectPath?: string | string[] | null;
  /** The product document's `productDriveId`: when set, nothing is created. */
  knownDriveId?: string | null;
}

interface Marker {
  switchboardUrl: string;
  driveId: string;
  /** Named, editor set and default access applied. */
  configured: boolean;
  /** Seed document keys already written. */
  seeded: string[];
  done: boolean;
}

const MARKER_FILE = path.join(".ph", "product-drive.json");

function markerPath(workdir: string): string {
  return path.join(workdir, MARKER_FILE);
}

function readMarker(workdir: string, switchboardUrl: string): Marker | null {
  try {
    const m = JSON.parse(fs.readFileSync(markerPath(workdir), "utf-8")) as Partial<Marker>;
    if (typeof m.driveId !== "string" || m.switchboardUrl !== switchboardUrl) return null;
    return {
      switchboardUrl,
      driveId: m.driveId,
      configured: m.configured === true,
      seeded: Array.isArray(m.seeded) ? m.seeded.filter((k): k is string => typeof k === "string") : [],
      done: m.done === true,
    };
  } catch {
    return null;
  }
}

function writeMarker(workdir: string, marker: Marker): void {
  const file = markerPath(workdir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(marker, null, 2));
  fs.renameSync(tmp, file);
}

/** `https://x.vetra.io` or `…/graphql` → the GraphQL endpoint. */
export function switchboardGraphqlEndpoint(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /\/graphql$/.test(trimmed) ? trimmed : `${trimmed}/graphql`;
}

/** True when the server answered (a refusal or a reducer error), not a network failure. */
function serverAnswered(err: unknown): boolean {
  return typeof err === "object" && err !== null && "response" in err;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function clientFor(ctx: ProductDriveContext, switchboardUrl: string): Promise<ProductDriveClient> {
  return ctx.driveClient ? ctx.driveClient(switchboardUrl) : createDriveClient(ctx, switchboardUrl);
}

/**
 * Create the product drive once and seed it with the example documents.
 * Returns the drive id. Never creates a second drive for the same product:
 * `knownDriveId` short-circuits, and an interrupted run resumes on the drive
 * it already created.
 */
export async function ensureProductDrive(
  ctx: ProductDriveContext,
  opts: EnsureProductDriveOptions,
): Promise<string> {
  if (opts.knownDriveId) return opts.knownDriveId;
  const endpoint = switchboardGraphqlEndpoint(opts.switchboardUrl);
  let marker = readMarker(ctx.workdir, endpoint);
  if (marker?.done) return marker.driveId;

  const client = await clientFor(ctx, endpoint);

  const step = async <T>(what: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (err) {
      if (err instanceof LaunchError) throw err;
      const detail = message(err);
      ctx.log?.warn?.(`[launch] product drive: ${what} failed: ${detail}`);
      throw new LaunchError(
        serverAnswered(err) ? "DRIVE_REFUSED" : "CLOUD_UNAVAILABLE",
        DRIVE_REASONS.create,
        `${what}: ${detail}`,
      );
    }
  };

  if (!marker) {
    const driveId = await step("createDrive", () => client.createDrive());
    marker = { switchboardUrl: endpoint, driveId, configured: false, seeded: [], done: false };
    writeMarker(ctx.workdir, marker);
    ctx.log?.info?.(`[launch] product drive ${driveId} created`);
  }

  if (!marker.configured) {
    const driveId = marker.driveId;
    await step("configureDrive", () =>
      client.configureDrive(driveId, {
        name: opts.name,
        ...(opts.appEditorId ? { preferredEditor: opts.appEditorId } : {}),
      }),
    );
    // Q3 default: open to signed-in users. A server without document
    // permissions is open to signed-in users anyway, so a refusal here only warns.
    try {
      await client.setProtection(driveId, DEFAULT_ACCESS === "OWNER_ONLY");
    } catch (err) {
      ctx.log?.warn?.(`[launch] product drive: default access not set: ${message(err)}`);
    }
    marker.configured = true;
    writeMarker(ctx.workdir, marker);
  }

  const projects = opts.projectPath ? [opts.projectPath].flat() : [];
  // Keys are per project, so two projects' `seed/x.json` never collide.
  const seeds: SeedDocument[] = projects.flatMap((p, i) =>
    validateSeeds(p).documents.map((d) => (i === 0 ? d : { ...d, key: `${path.basename(p)}/${d.key}` })),
  );
  for (const doc of seeds) {
    if (marker.seeded.includes(doc.key)) continue;
    try {
      await client.addDocument(marker.driveId, {
        documentType: doc.documentType,
        name: doc.name,
        actions: doc.actions,
      });
    } catch (err) {
      if (!serverAnswered(err)) {
        ctx.log?.warn?.(`[launch] product drive: seeding stopped: ${message(err)}`);
        throw new LaunchError("CLOUD_UNAVAILABLE", DRIVE_REASONS.create, `addDocument: ${message(err)}`);
      }
      // The server refused this example: skip it rather than block the launch.
      ctx.log?.warn?.(`[launch] product drive: example "${doc.name}" skipped: ${message(err)}`);
    }
    marker.seeded.push(doc.key);
    writeMarker(ctx.workdir, marker);
  }

  marker.done = true;
  writeMarker(ctx.workdir, marker);
  return marker.driveId;
}

/**
 * Switch who can use the product: `OWNER_ONLY` protects the drive,
 * `SIGNED_IN` (Q3 default) unprotects it. Invoked by the requests trigger
 * (F35). A refusal throws `LaunchError` (`ACCESS_REFUSED`); if the delegated
 * identity may not change protection, Task 2.9's browser-signed path applies.
 */
export async function setAccess(
  ctx: ProductDriveContext,
  access: ProductAccess,
  target: { switchboardUrl: string; driveId: string },
): Promise<void> {
  const client = await clientFor(ctx, switchboardGraphqlEndpoint(target.switchboardUrl));
  try {
    await client.setProtection(target.driveId, access === "OWNER_ONLY");
  } catch (err) {
    if (err instanceof LaunchError) throw err;
    ctx.log?.warn?.(`[launch] product drive: access ${access} refused: ${message(err)}`);
    throw new LaunchError(
      serverAnswered(err) ? "ACCESS_REFUSED" : "CLOUD_UNAVAILABLE",
      DRIVE_REASONS.access,
      `setDocumentProtection: ${message(err)}`,
    );
  }
}

/* ------------------------------------------------------------------------ */
/* Default client: reactor GraphQL as the owner's delegated identity.        */
/* ------------------------------------------------------------------------ */

const DRIVE_TYPE = "powerhouse/document-drive";

const SET_PROTECTION = `mutation SetDocumentProtection($documentIdOrSlug: String!, $protected: Boolean!) {
  setDocumentProtection(documentIdOrSlug: $documentIdOrSlug, protected: $protected) { documentId protected }
}`;

/** The drive's `global.name` as the server has it, if any. */
function driveName(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null || !("global" in state)) return undefined;
  const global: unknown = state.global;
  if (typeof global !== "object" || global === null || !("name" in global)) return undefined;
  return typeof global.name === "string" ? global.name : undefined;
}

/**
 * The real client: the agent's Renown bearer on every request and its signer
 * on every action (each action is stamped on the document as the server has
 * it, then signed — one at a time, so no local reducer is needed).
 */
export async function createDriveClient(
  ctx: CloudContext,
  endpoint: string,
  deps: { signer?: ISigner } = {},
): Promise<ProductDriveClient> {
  const { renownUrl } = resolveCloudConfig(ctx.config);
  let signer = deps.signer;
  if (!signer) {
    const renown = await getRenown(ctx.workdir, renownUrl);
    if (!renown.user) {
      throw new LaunchError(
        "PERMISSION",
        "your Studio needs your OK to publish",
        "The agent is not signed in with the owner's Renown identity.",
      );
    }
    signer = renown.signer;
  }
  const actionSigner = signer;
  const [{ createReactorClient }, rb, dm, drive] = await Promise.all([
    import("@powerhousedao/vetra-cloud-client"),
    import("@powerhousedao/reactor-browser"),
    import("document-model"),
    import("@powerhousedao/shared/document-drive"),
  ]);
  let token: string | null = null;
  const bearer = ctx.bearerToken ?? (() => getBearerToken(ctx.workdir, renownUrl));
  const client = createReactorClient(endpoint, async () => (token = await bearer()));
  const scrub = (err: unknown): Error => {
    const e = err instanceof Error ? err : new Error(String(err));
    e.message = redact(e.message, [token]);
    return e;
  };

  const newAction = (type: string, input: unknown, scope: string) =>
    ({
      id: dm.generateId(),
      type,
      input,
      scope,
      timestampUtcMs: new Date().toISOString(),
    }) as Parameters<typeof rb.stampAction>[0];

  async function apply(documentId: string, actions: ReturnType<typeof newAction>[]): Promise<void> {
    for (const action of actions) {
      const got = await client.GetDocument({ identifier: documentId });
      if (!got.document) throw new Error(`Document ${documentId} not found after creating it.`);
      const snapshot = rb.phDocumentFromGetDocument(got.document.document);
      const [signed] = await rb.prepareSignedActions([action], snapshot, actionSigner);
      await client.MutateDocument({
        documentIdentifier: documentId,
        actions: [dm.toTransportAction(signed)],
      });
    }
  }

  return {
    async createDrive() {
      try {
        const created = await client.CreateEmptyDocument({ documentType: DRIVE_TYPE });
        return created.createEmptyDocument.id;
      } catch (err) {
        throw scrub(err);
      }
    },
    async configureDrive(id, { name, preferredEditor }) {
      try {
        await client.RenameDocument({ documentIdentifier: id, name });
        const got = await client.GetDocument({ identifier: id });
        const current = driveName(got.document?.document.state);
        if (current !== name) {
          await apply(id, [newAction(drive.setDriveName({ name }).type, { name }, "global")]);
        }
        if (preferredEditor) {
          await client.SetPreferredEditor({ documentIdentifier: id, preferredEditor });
        }
      } catch (err) {
        throw scrub(err);
      }
    },
    async addDocument(driveId, doc) {
      try {
        const created = await client.CreateEmptyDocument({
          documentType: doc.documentType,
          parentIdentifier: driveId,
        });
        const id = created.createEmptyDocument.id;
        await client.RenameDocument({ documentIdentifier: id, name: doc.name });
        await apply(
          id,
          doc.actions.map((a) => newAction(a.type, a.input, a.scope)),
        );
        return id;
      } catch (err) {
        throw scrub(err);
      }
    },
    async setProtection(driveId, isProtected) {
      try {
        await client.RunDocument({
          operationName: "SetDocumentProtection",
          operationType: "mutation",
          document: SET_PROTECTION,
          variables: { documentIdOrSlug: driveId, protected: isProtected },
        });
      } catch (err) {
        throw scrub(err);
      }
    },
  };
}
