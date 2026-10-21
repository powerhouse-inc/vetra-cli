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
 * Once only, even when a response or the workdir is lost:
 * - the product document's `productDriveId` (`knownDriveId`) short-circuits;
 * - the drive carries the stable slug `product-<appId>`; before creating, the
 *   live server is asked for a drive with that slug and a hit is adopted;
 * - a marker in the workdir records the drive, whether the default access was
 *   applied, and each example's document id (written before its operations),
 *   so a retry resumes on the same documents. Operations already on a
 *   document (its revision) are not sent again.
 *
 * An adopted drive is never changed: its current protection is read and
 * reported, the default access is not applied, and examples are added only
 * when the drive has never been changed since it was created (no operations,
 * i.e. the answer to its creation was lost) — a customer who deleted the
 * examples never gets them back.
 *
 * Access (Q3 default `SIGNED_IN`): the drive is left unprotected, so any
 * signed-in Renown user can open and write it; `setAccess(…, 'OWNER_ONLY')`
 * protects it (`setDocumentProtection`). Whether the switchboard lets
 * anonymous visitors read an unprotected drive is the switchboard's policy.
 *
 * Live verification (Task 2.6 Step 1, run on a staging production env): see
 * the task report.
 */
import fs from "node:fs";
import path from "node:path";
import type { Action, ISigner } from "document-model";
import { getBearerToken, getRenown } from "../auth/renown.js";
import { resolveCloudConfig } from "../cloud/config.js";
import { redact, type CloudContext } from "./cloud-launch.js";
import { LaunchError } from "./errors.js";
import { EXAMPLE_PREFIX, validateSeeds, type SeedAction, type SeedDocument } from "./seed.js";

export type ProductAccess = "OWNER_ONLY" | "SIGNED_IN";

/** Q3: anyone with the link, after Renown sign-in. */
export const DEFAULT_ACCESS: ProductAccess = "SIGNED_IN";

/** Plain reasons (the UI prefixes "Couldn't go live:"; F39). */
export const DRIVE_REASONS = {
  create: "your product's data space couldn't be set up",
  access: "who can use your product couldn't be changed",
} as const;

/** The drive's stable slug: one per App, so a lost answer or workdir never leads to a second drive. */
export function productDriveSlug(appId: string): string {
  return `product-${appId}`;
}

export interface FoundDocument {
  id: string;
  name: string;
  documentType: string;
}

/** The calls on the live server, as the owner's delegated identity. */
export interface ProductDriveClient {
  /** The drive with this slug, or null; `untouched` when it has no operations yet (created, never changed). */
  findDrive(slug: string): Promise<{ id: string; untouched: boolean } | null>;
  /** Whether the drive is protected (`documentProtection`). */
  getProtection(driveId: string): Promise<boolean>;
  /** Create the drive in one request (slug, name and app view set at creation); returns its id. */
  createDrive(input: { slug: string; name: string; preferredEditor?: string }): Promise<string>;
  /** The documents already in the drive. */
  listDocuments(driveId: string): Promise<FoundDocument[]>;
  /**
   * The distinct action types in a document's operation history (every
   * scope), read page by page; throws once more than `maxOperations` would
   * have to be read. Read-only (go back's data check, D6).
   */
  operationTypes?(documentId: string, maxOperations: number): Promise<string[]>;
  /** Create one empty document in the drive, named `name`; returns its id. */
  createDocument(driveId: string, input: { documentType: string; name: string }): Promise<string>;
  /**
   * Apply `actions` in order. Actions the document already has (per scope,
   * by its revision) are not sent again, so a retry never repeats one.
   */
  applyActions(documentId: string, actions: SeedAction[]): Promise<void>;
  /** `setDocumentProtection(documentIdOrSlug, protected)`. */
  setProtection(driveId: string, isProtected: boolean): Promise<void>;
}

export interface ProductDriveContext extends CloudContext {
  /** Seam for tests; defaults to the delegated-identity GraphQL client (`createDriveClient`). */
  driveClient?: (switchboardUrl: string) => Promise<ProductDriveClient>;
}

export interface EnsureProductDriveOptions {
  /** The product's App (its id makes the drive's stable slug). */
  appId: string;
  /** The product's live server (base URL or its `/graphql` endpoint). */
  switchboardUrl: string;
  /** The product's name — the drive's name. */
  name: string;
  /** The product's app view, when it has one: the drive's preferred editor. */
  appEditorId?: string | null;
  /** The reactor project(s) holding `seed/*.json` (a workspace's projects ship as one product); no seeding when absent. */
  projectPath?: string | string[] | null;
  /** The product document's `productDriveId`: when set, nothing is created or called. */
  knownDriveId?: string | null;
}

export interface ProductDriveResult {
  driveId: string;
  /**
   * The default access (Q3) is in place. False when the server refused it:
   * the requests trigger (2.7) applies it again with `setAccess`. Null when
   * not known here (`knownDriveId` without a local record).
   */
  accessApplied: boolean | null;
  /**
   * The drive's access as last applied or read. For an adopted drive it is
   * the drive's current protection, left as it is; null when unknown.
   */
  access: ProductAccess | null;
  /** Example documents the server refused (names); they are not retried. */
  failedExamples: string[];
}

type ExampleStatus = "created" | "done" | "failed";

interface ExampleRecord {
  key: string;
  docId: string | null;
  status: ExampleStatus;
  name: string;
  error?: string;
}

interface Marker {
  switchboardUrl: string;
  driveId: string;
  /** Found by its slug instead of created: never changed, its protection only read. */
  adopted: boolean;
  /** Examples may be added (a drive created here, or adopted untouched). */
  seed: boolean;
  accessApplied: boolean;
  /** This Studio has set the protection; false while an adopted drive's value is only read. */
  accessSet: boolean;
  access: ProductAccess | null;
  examples: ExampleRecord[];
  done: boolean;
}

const MARKER_FILE = path.join(".ph", "product-drive.json");

function markerPath(workdir: string): string {
  return path.join(workdir, MARKER_FILE);
}

/** The product drive this Studio launched into, from the workdir marker. */
export function storedProductDrive(
  workdir: string,
): { driveId: string; switchboardUrl: string } | null {
  const m = readMarker(workdir);
  return m ? { driveId: m.driveId, switchboardUrl: m.switchboardUrl } : null;
}

function readMarker(workdir: string): Marker | null {
  try {
    const m = JSON.parse(fs.readFileSync(markerPath(workdir), "utf-8")) as Partial<Marker>;
    if (typeof m.driveId !== "string" || typeof m.switchboardUrl !== "string") return null;
    return {
      switchboardUrl: m.switchboardUrl,
      driveId: m.driveId,
      adopted: m.adopted === true,
      seed: m.seed !== false,
      accessApplied: m.accessApplied === true,
      accessSet: m.accessSet === true,
      access: m.access === "OWNER_ONLY" || m.access === "SIGNED_IN" ? m.access : null,
      examples: Array.isArray(m.examples) ? m.examples : [],
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

function resultOf(marker: Marker): ProductDriveResult {
  return {
    driveId: marker.driveId,
    accessApplied: marker.accessApplied,
    access: marker.access,
    failedExamples: marker.examples.filter((e) => e.status === "failed").map((e) => e.name),
  };
}

/** The drive's access as this Studio last applied or read it; null without a local record. */
export interface ProductDriveRecord {
  /** The live server's GraphQL endpoint. */
  switchboardUrl: string;
  driveId: string;
  access: ProductAccess | null;
  accessApplied: boolean;
  /** Found by its slug: its protection is read, not set, unless a later switch changes it. */
  adopted: boolean;
  /** This Studio has set the protection; false while an adopted value is only read. */
  accessSet: boolean;
}

export function readProductDriveRecord(workdir: string): ProductDriveRecord | null {
  const m = readMarker(workdir);
  return m
    ? {
        switchboardUrl: m.switchboardUrl,
        driveId: m.driveId,
        access: m.access,
        accessApplied: m.accessApplied,
        adopted: m.adopted,
        accessSet: m.accessSet,
      }
    : null;
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

/** How many documents the product drive holds on the live server (D6: is there live data?). */
export async function countDriveDocuments(
  ctx: ProductDriveContext,
  switchboardUrl: string,
  driveId: string,
): Promise<number> {
  const client = await clientFor(ctx, switchboardGraphqlEndpoint(switchboardUrl));
  return (await client.listDocuments(driveId)).length;
}

/** The example documents of every project; schema-invalid ones are logged and left out. */
function loadExamples(ctx: ProductDriveContext, projectPath: EnsureProductDriveOptions["projectPath"]): SeedDocument[] {
  const projects = projectPath ? [projectPath].flat() : [];
  return projects.flatMap((p, i) => {
    const { documents, problems } = validateSeeds(p);
    for (const pr of problems) {
      ctx.log?.warn?.(
        `[launch] product drive: example left out (${pr.file}${pr.document ? ` "${pr.document}"` : ""}): ${pr.message}`,
      );
    }
    // Keys are per project, so two projects' `seed/x.json` never collide.
    return documents.map((d) => (i === 0 ? d : { ...d, key: `${path.basename(p)}/${d.key}` }));
  });
}

/**
 * Create the product drive once and seed it with the example documents.
 * Never creates a second drive for the same App (see the module comment).
 */
export async function ensureProductDrive(
  ctx: ProductDriveContext,
  opts: EnsureProductDriveOptions,
): Promise<ProductDriveResult> {
  const endpoint = switchboardGraphqlEndpoint(opts.switchboardUrl);
  let marker = readMarker(ctx.workdir);
  if (marker && marker.switchboardUrl !== endpoint) marker = null;
  if (opts.knownDriveId) {
    return marker?.driveId === opts.knownDriveId
      ? resultOf(marker)
      : { driveId: opts.knownDriveId, accessApplied: null, access: null, failedExamples: [] };
  }
  if (marker?.done) return resultOf(marker);

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
    const slug = productDriveSlug(opts.appId);
    const found = await step("findDrive", () => client.findDrive(slug));
    let driveId: string;
    if (found) {
      driveId = found.id;
      ctx.log?.info?.(
        `[launch] product drive ${driveId} found by its slug; using it as it is${found.untouched ? "" : " (no examples added)"}`,
      );
    } else {
      driveId = await step("createDrive", () =>
        client.createDrive({
          slug,
          name: opts.name,
          ...(opts.appEditorId ? { preferredEditor: opts.appEditorId } : {}),
        }),
      );
      ctx.log?.info?.(`[launch] product drive ${driveId} created`);
    }
    marker = {
      switchboardUrl: endpoint,
      driveId,
      adopted: found !== null,
      seed: found === null || found.untouched,
      accessApplied: false,
      accessSet: false,
      access: null,
      examples: [],
      done: false,
    };
    writeMarker(ctx.workdir, marker);
  }
  const m: Marker = marker;

  if (m.adopted && !m.accessApplied) {
    // Never change an adopted drive's access: read it and report it.
    try {
      const isProtected = await client.getProtection(m.driveId);
      m.access = isProtected ? "OWNER_ONLY" : "SIGNED_IN";
      m.accessApplied = true;
    } catch (err) {
      ctx.log?.warn?.(`[launch] product drive: current access not read: ${message(err)}`);
    }
    writeMarker(ctx.workdir, m);
  } else if (!m.accessApplied) {
    // Q3 default: open to signed-in users. A refusal doesn't stop the launch;
    // it is reported (`accessApplied: false`) so the requests trigger retries.
    try {
      await client.setProtection(m.driveId, DEFAULT_ACCESS === "OWNER_ONLY");
      m.accessApplied = true;
      m.accessSet = true;
      m.access = DEFAULT_ACCESS;
    } catch (err) {
      ctx.log?.warn?.(`[launch] product drive: default access not applied: ${message(err)}`);
    }
    writeMarker(ctx.workdir, m);
  }

  const examples = m.seed ? loadExamples(ctx, opts.projectPath) : [];
  // Documents already in the drive, read at most once: an adopted drive (lost
  // workdir) or a creation whose answer was lost may hold an example already.
  let existing: FoundDocument[] | null = null;
  const findExisting = async (doc: SeedDocument): Promise<string | null> => {
    existing ??= await step("listDocuments", () => client.listDocuments(m.driveId));
    const claimed = new Set(m.examples.map((e) => e.docId));
    return (
      existing.find(
        (e) =>
          e.name.startsWith(EXAMPLE_PREFIX) &&
          e.name === doc.name &&
          e.documentType === doc.documentType &&
          !claimed.has(e.id),
      )?.id ?? null
    );
  };

  for (const doc of examples) {
    let rec = m.examples.find((e) => e.key === doc.key);
    if (rec && rec.status !== "created") continue;
    if (rec && !rec.docId) rec.docId = await findExisting(doc); // an earlier creation's answer was lost
    if (!rec) {
      rec = { key: doc.key, docId: m.adopted ? await findExisting(doc) : null, status: "created", name: doc.name };
      m.examples.push(rec);
      // Recorded before the creation, so a lost answer is looked up on the retry.
      writeMarker(ctx.workdir, m);
    }
    const record = rec;
    try {
      if (!record.docId) {
        record.docId = await client.createDocument(m.driveId, {
          documentType: doc.documentType,
          name: doc.name,
        });
        // Recorded before any operation, so a retry resumes on this document.
        writeMarker(ctx.workdir, m);
      }
      await client.applyActions(record.docId, doc.actions);
      record.status = "done";
    } catch (err) {
      if (!serverAnswered(err)) {
        writeMarker(ctx.workdir, m);
        ctx.log?.warn?.(`[launch] product drive: seeding stopped: ${message(err)}`);
        throw new LaunchError("CLOUD_UNAVAILABLE", DRIVE_REASONS.create, `seed "${doc.name}": ${message(err)}`);
      }
      // The server refused this example: recorded and reported, the launch goes on.
      record.status = "failed";
      record.error = message(err);
      ctx.log?.warn?.(`[launch] product drive: example "${doc.name}" refused: ${record.error}`);
    }
    writeMarker(ctx.workdir, m);
  }

  m.done = true;
  writeMarker(ctx.workdir, m);
  return resultOf(m);
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
  const endpoint = switchboardGraphqlEndpoint(target.switchboardUrl);
  const client = await clientFor(ctx, endpoint);
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
  const marker = readMarker(ctx.workdir);
  if (marker && marker.driveId === target.driveId && marker.switchboardUrl === endpoint) {
    marker.accessApplied = true;
    marker.accessSet = true;
    marker.access = access;
    writeMarker(ctx.workdir, marker);
  }
}

/**
 * The product document now carries the protection an adopted drive was found
 * with (Task 2.7): from here on the switch owns the drive, so a later change
 * is pushed. Writes nothing when the marker isn't for this drive.
 */
export function markAccessAdopted(
  ctx: ProductDriveContext,
  target: { switchboardUrl: string; driveId: string },
): void {
  const endpoint = switchboardGraphqlEndpoint(target.switchboardUrl);
  const marker = readMarker(ctx.workdir);
  if (marker && marker.driveId === target.driveId && marker.switchboardUrl === endpoint) {
    marker.accessSet = true;
    writeMarker(ctx.workdir, marker);
  }
}

/* ------------------------------------------------------------------------ */
/* Default client: reactor GraphQL as the owner's delegated identity.        */
/* ------------------------------------------------------------------------ */

const DRIVE_TYPE = "powerhouse/document-drive";
const PAGE = 100;

const GET_PROTECTION = `query DocumentProtection($documentIdOrSlug: String!) {
  documentProtection(documentIdOrSlug: $documentIdOrSlug) { documentId protected }
}`;

const SET_PROTECTION = `mutation SetDocumentProtection($documentIdOrSlug: String!, $protected: Boolean!) {
  setDocumentProtection(documentIdOrSlug: $documentIdOrSlug, protected: $protected) { documentId protected }
}`;

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
  const scrubbed = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      e.message = redact(e.message, [token]);
      throw e;
    }
  };

  /** Every page of a `findDocuments` search. */
  async function find(search: { type?: string; parentId?: string }) {
    const items: Array<{
      id: string;
      slug?: string | null;
      name: string;
      documentType: string;
      revisionsList: ReadonlyArray<{ scope: string; revision: number }>;
    }> = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await client.FindDocuments({ search, paging: { limit: PAGE, ...(cursor ? { cursor } : {}) } });
      items.push(...res.findDocuments.items);
      if (!res.findDocuments.hasNextPage || !res.findDocuments.cursor) break;
      cursor = res.findDocuments.cursor;
    }
    return items;
  }

  return {
    findDrive: (slug) =>
      scrubbed(async () => {
        const hit = (await find({ type: DRIVE_TYPE })).find((d) => d.slug === slug);
        if (!hit) return null;
        // No operation in any scope: created and never changed since.
        return { id: hit.id, untouched: hit.revisionsList.every((r) => r.revision === 0) };
      }),
    getProtection: (driveId) =>
      scrubbed(async () => {
        const data = await client.RunDocument<{ documentProtection: { protected: boolean } }>({
          operationName: "DocumentProtection",
          document: GET_PROTECTION,
          variables: { documentIdOrSlug: driveId },
        });
        return data.documentProtection.protected;
      }),
    createDrive: ({ slug, name, preferredEditor }) =>
      scrubbed(async () => {
        const doc = dm.withSignaturePolicy(
          drive.driveCreateDocument({ global: { name, icon: null, nodes: [] } }),
          dm.DEFAULT_SIGNATURE_POLICY,
        );
        doc.header.slug = slug;
        doc.header.name = name;
        if (preferredEditor) doc.header.meta = { ...doc.header.meta, preferredEditor };
        const created = await client.CreateDocument({ document: doc });
        return created.createDocument.id;
      }),
    listDocuments: (driveId) =>
      scrubbed(async () =>
        (await find({ parentId: driveId })).map((d) => ({ id: d.id, name: d.name, documentType: d.documentType })),
      ),
    operationTypes: (documentId, maxOperations) =>
      scrubbed(async () => {
        const types = new Set<string>();
        let read = 0;
        let cursor: string | null | undefined;
        for (;;) {
          const res = await client.GetDocumentOperations({
            filter: { documentIdOrSlug: documentId },
            paging: { limit: PAGE, ...(cursor ? { cursor } : {}) },
          });
          const page = res.documentOperations;
          for (const op of page.items) types.add(op.action.type);
          read += page.items.length;
          if (!page.hasNextPage || !page.cursor || page.items.length === 0) break;
          if (read >= maxOperations) {
            throw new Error(`Document ${documentId} has more than ${maxOperations} operations.`);
          }
          cursor = page.cursor;
        }
        return [...types];
      }),
    createDocument: (driveId, { documentType, name }) =>
      scrubbed(async () => {
        const created = await client.CreateEmptyDocument({ documentType, parentIdentifier: driveId });
        const id = created.createEmptyDocument.id;
        await client.RenameDocument({ documentIdentifier: id, name });
        return id;
      }),
    applyActions: (documentId, actions) =>
      scrubbed(async () => {
        const seen: Record<string, number> = {};
        for (const a of actions) {
          const index = seen[a.scope] ?? 0;
          seen[a.scope] = index + 1;
          const got = await client.GetDocument({ identifier: documentId });
          if (!got.document) throw new Error(`Document ${documentId} not found.`);
          const revision = got.document.document.revisionsList.find((r) => r.scope === a.scope)?.revision ?? 0;
          // Already applied by an earlier try whose answer was lost.
          if (revision > index) continue;
          const action: Action = dm.createAction(a.type, a.input, undefined, undefined, a.scope);
          const snapshot = rb.phDocumentFromGetDocument(got.document.document);
          const [signed] = await rb.prepareSignedActions([action], snapshot, actionSigner);
          await client.MutateDocument({
            documentIdentifier: documentId,
            actions: [dm.toTransportAction(signed)],
          });
        }
      }),
    setProtection: (driveId, isProtected) =>
      scrubbed(async () => {
        await client.RunDocument({
          operationName: "SetDocumentProtection",
          operationType: "mutation",
          document: SET_PROTECTION,
          variables: { documentIdOrSlug: driveId, protected: isProtected },
        });
      }),
  };
}
