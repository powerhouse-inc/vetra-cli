/**
 * The Studio's `vetra/studio-team` document: org ownership and the review
 * switch, created once per Studio drive by the agent process.
 *
 * Signature policy (Frank 2026-10-21):
 * - cloud Studio (an environment id): the document is created v2-required and
 *   `INIT_TEAM` is signed by the agent's logged-in delegation. Without one the
 *   document is not created (`pending`), and the next call tries again.
 * - local Studio: legacy document, unsigned `INIT_TEAM`.
 * In both cases the pod keeps the document id in `.ph/vetra/team/doc.json` and
 * only ever reads that document. A generated id is used (a fixed id would force
 * the legacy policy).
 */
import fs from "node:fs";
import path from "node:path";
import { StudioTeamV1 } from "vetra-app/document-models";
import type { StudioTeamState } from "vetra-app/document-models/studio-team";
import { addFile } from "@powerhousedao/shared/document-drive";
import {
  actionSignerIdentity,
  actionSigningTarget,
  generateId,
  normalizeDocumentModelVersion,
  withSignaturePolicy,
  type Action,
  type ISigner,
  type PHDocument,
} from "@powerhousedao/shared/document-model";
import { getSigner } from "../auth/renown.js";
import { resolveCloudConfig } from "../cloud/config.js";
import type { Config } from "../framework.js";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";
import type { ProductContext } from "../product/product-doc.js";
import type { Operation } from "./trust.js";

export const STUDIO_TEAM_TYPE = "vetra/studio-team";
export const TEAM_DOC_FILE = path.join(".ph", "vetra", "team", "doc.json");

export interface TeamDeps {
  /** The signer for cloud Studios; undefined when nobody is signed in. */
  signer: () => Promise<ISigner | undefined>;
}

export interface TeamContext extends ProductContext {
  workdir: string;
  config: Pick<Config, "environmentId" | "studioOrgId" | "cloudRenownUrl">;
  now?: () => Date;
  /** Seams for tests. */
  teamDeps?: Partial<TeamDeps>;
}

interface TeamClient {
  get(documentId: string): Promise<unknown>;
  getOperations(
    documentId: string,
    opts: { branch: string; scopes: string[] },
  ): Promise<{ results: Operation[] }>;
  execute(documentId: string, branch: string, actions: Action[]): Promise<unknown>;
  createDocumentInDrive(driveId: string, doc: unknown): Promise<{ header: { id: string } }>;
}

/** True when an organisation owns this Studio. */
export function isOrgStudio(config: Pick<Config, "studioOrgId">): boolean {
  return Boolean(config.studioOrgId);
}

function readDocId(workdir: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(workdir, TEAM_DOC_FILE), "utf-8")) as {
      documentId?: unknown;
    };
    return typeof parsed.documentId === "string" ? parsed.documentId : null;
  } catch {
    return null;
  }
}

function writeDocId(workdir: string, documentId: string): void {
  const file = path.join(workdir, TEAM_DOC_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ documentId }, null, 2));
}

/** A document-scope action, as the reactor's own action builders make them. */
function documentAction(type: string, input: Record<string, unknown>): Action {
  return { id: generateId(), type, scope: "document", timestampUtcMs: new Date().toISOString(), input } as Action;
}

async function signFor(action: Action, signer: ISigner, documentId: string): Promise<Action> {
  const signature = await signer.signAction(action, actionSigningTarget(action, documentId, "main"));
  return {
    ...action,
    context: { ...action.context, signer: { ...actionSignerIdentity(signer), signatures: [signature] } },
  };
}

/**
 * Add a v2-required document to the drive with signed creation. The embedded
 * client signs with a passthrough signer, which a v2-required document refuses,
 * so the create / relationship / file actions are signed here, in the same
 * order `drives.addFile` runs them.
 */
async function addSignedFile(client: TeamClient, driveId: string, doc: PHDocument, signer: ISigner): Promise<string> {
  const h = doc.header;
  const documentId = h.id;
  const toVersion = normalizeDocumentModelVersion(
    (doc.state as { document?: { version?: number } }).document?.version,
  );
  const documentActions = await Promise.all(
    [
      documentAction("CREATE_DOCUMENT", {
        model: h.documentType,
        version: 0,
        documentId,
        signing: {
          signature: documentId,
          publicKey: h.sig.publicKey,
          nonce: h.sig.nonce,
          createdAtUtcIso: h.createdAtUtcIso,
          documentType: h.documentType,
        },
        slug: h.slug,
        name: h.name,
        branch: h.branch,
        meta: h.meta,
        protocolVersions: h.protocolVersions ?? { "base-reducer": 2 },
      }),
      documentAction("UPGRADE_DOCUMENT", {
        documentId,
        model: h.documentType,
        fromVersion: 0,
        toVersion,
        initialState: doc.state,
      }),
      documentAction("ADD_RELATIONSHIP", { sourceId: driveId, targetId: documentId, relationshipType: "child" }),
    ].map((a) => signFor(a, signer, documentId)),
  );
  await client.execute(documentId, "main", documentActions);
  const fileAction = await signFor(
    addFile({ id: documentId, name: h.name || documentId, documentType: h.documentType }) as Action,
    signer,
    driveId,
  );
  await client.execute(driveId, "main", [fileAction]);
  return documentId;
}

async function defaultSigner(ctx: TeamContext): Promise<ISigner | undefined> {
  const signer = await getSigner(ctx.workdir, resolveCloudConfig(ctx.config).renownUrl);
  return signer.user ? signer : undefined;
}

interface TeamDocLike {
  state?: { global?: StudioTeamState };
}

async function readState(client: TeamClient, id: string): Promise<StudioTeamState | null> {
  try {
    return ((await client.get(id)) as TeamDocLike)?.state?.global ?? null;
  } catch {
    return null;
  }
}

/**
 * Make sure the Studio has its initialised team document. Idempotent. Returns
 * `pending` while a cloud Studio has no signed-in delegation, or when no
 * reactor is running yet.
 */
export async function ensureTeamDoc(
  ctx: TeamContext,
): Promise<{ documentId: string | null; pending: boolean }> {
  const drive = await getEmbeddedDrive(ctx);
  if (!drive) return { documentId: null, pending: true };
  const client = drive.reactor.client as unknown as TeamClient;
  const cloud = Boolean(ctx.config.environmentId);

  let documentId = readDocId(ctx.workdir);
  if (documentId && !(await readState(client, documentId))) documentId = null;

  let signer: ISigner | undefined;
  if (cloud) {
    signer = await (ctx.teamDeps?.signer ?? (() => defaultSigner(ctx)))();
    if (!signer?.user) return { documentId, pending: documentId === null };
  }

  if (!documentId) {
    // A crash between creating and recording leaves a file in the drive.
    const driveDoc = (await client.get(drive.driveId)) as {
      state?: { global?: { nodes?: { id: string; kind: string; documentType?: string }[] } };
    };
    documentId =
      driveDoc?.state?.global?.nodes?.find((n) => n.kind === "file" && n.documentType === STUDIO_TEAM_TYPE)?.id ??
      null;
  }
  if (!documentId) {
    const doc = withSignaturePolicy(StudioTeamV1.utils.createDocument(), cloud ? "v2-required" : "legacy");
    documentId = signer
      ? await addSignedFile(client, drive.driveId, doc, signer)
      : (await client.createDocumentInDrive(drive.driveId, doc)).header.id;
  }
  writeDocId(ctx.workdir, documentId);

  const state = await readState(client, documentId);
  if (!state?.initialized) {
    const orgId = ctx.config.studioOrgId || null;
    const at = (ctx.now ?? (() => new Date()))().toISOString();
    const action = StudioTeamV1.actions.initTeam({ orgId, reviewRequired: Boolean(orgId), at });
    let actions: Action[] = [action];
    if (signer) {
      const { prepareSignedActions } = await import("@powerhousedao/reactor-browser");
      const snapshot = (await client.get(documentId)) as Parameters<typeof prepareSignedActions>[1];
      actions = await prepareSignedActions(actions, snapshot, signer);
    }
    await client.execute(documentId, "main", actions);
  }
  return { documentId, pending: false };
}

/** The team document's state, or null when there is none yet. */
export async function getTeamState(ctx: TeamContext): Promise<StudioTeamState | null> {
  const id = readDocId(ctx.workdir);
  if (!id) return null;
  const drive = await getEmbeddedDrive(ctx);
  if (!drive) return null;
  return readState(drive.reactor.client as unknown as TeamClient, id);
}

/** The stored team document and its global operations (task 1.8's trust input). */
export interface TeamDocumentSnapshot {
  documentId: string;
  state: StudioTeamState | null;
  operations: Operation[];
}

/**
 * Read the team document's operations. Throws when the reactor cannot answer:
 * a security decision must refuse rather than judge against an empty list.
 */
export async function readTeamDocument(ctx: TeamContext): Promise<TeamDocumentSnapshot | null> {
  const documentId = readDocId(ctx.workdir);
  if (!documentId) return null;
  const drive = await getEmbeddedDrive(ctx);
  if (!drive) return null;
  const client = drive.reactor.client as unknown as TeamClient;
  const { results } = await client.getOperations(documentId, {
    branch: "main",
    scopes: ["global"],
  });
  return { documentId, state: await readState(client, documentId), operations: results };
}
