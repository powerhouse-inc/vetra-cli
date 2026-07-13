/**
 * Helpers for interacting with the preview drive of a running reactor-project.
 *
 * Each reactor-project (a `ph vetra` instance) provisions a hardcoded preview
 * drive whose id is derived from the project's filesystem path. The same
 * derivation runs in `monorepo/clis/ph-cli/src/utils.ts` (`generateProjectDriveId`)
 * so Switchboard, Connect, and the agent agree on the id without coordination.
 *
 * The `spec-preview-*` commands target this drive through the project's
 * Switchboard GraphQL endpoint rather than the on-disk reactor store — the
 * running process owns the storage and concurrent file writes are unsafe.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ServiceManager } from "@powerhousedao/ph-clint";
import { getBearerToken } from "../auth/renown.js";
import { resolveCloudConfig } from "../cloud/config.js";
import { REACTOR_PROJECT_SWITCHBOARD_PROXY_PATH } from "../constants.js";
import type { Config } from "../framework.js";
import { formatLines, unknownValueError } from "./cli-errors.js";

const PREVIEW_DRIVE_PREFIX = "preview";

/**
 * Compute the preview drive id for a reactor-project rooted at `projectPath`.
 *
 * Mirrors `generateProjectDriveId("preview")` from
 * `monorepo/clis/ph-cli/src/utils.ts`: short sha256 of the project root path.
 * Keep the two implementations in sync — diverging here silently sends
 * mutations to a non-existent drive.
 *
 * Resolve symlinks before hashing because the reactor side uses
 * `process.cwd()`, which on macOS normalises `/var/...` to `/private/var/...`
 * automatically. Without realpath here, a workdir under `mkdtemp(tmpdir())`
 * hashes to a different id on each side and `createEmptyDocument` fails with
 * "Document not found: preview-…".
 */
export function getPreviewDriveId(projectPath: string): string {
  const canonical = canonicalProjectPath(projectPath);
  const hash = crypto
    .createHash("sha256")
    .update(canonical)
    .digest("hex")
    .slice(0, 8);
  return `${PREVIEW_DRIVE_PREFIX}-${hash}`;
}

// Compare project paths by canonical (realpath) form — a running instance
// registers a realpath'd workdir (macOS /var → /private/var) a raw compare misses.
function sameProjectPath(a: string | undefined, b: string): boolean {
  return a !== undefined && canonicalProjectPath(a) === canonicalProjectPath(b);
}

function canonicalProjectPath(projectPath: string): string {
  try {
    return fs.realpathSync(projectPath);
  } catch {
    /* If the path doesn't exist yet (rare — callers go through
     * resolveReactorProjectPath which already validates), fall back to the
     * raw string. Better to attempt the request and surface a clear GQL
     * error than to throw something cryptic from here. */
    return projectPath;
  }
}

/**
 * Resolve the running reactor-project instance for `projectPath` and return the
 * Switchboard GraphQL URL plus the preview drive id.
 *
 * Errors with a runnable hint if no live instance is registered for the path.
 * Does not attempt to start the service — lifecycle stays explicit.
 */
export function resolvePreviewEndpoint(
  services: ServiceManager | undefined,
  projectPath: string,
  projectLabel: string,
): { switchboardUrl: string; connectUrl: string | undefined; driveId: string } {
  if (!services) {
    throw new Error(
      "Service manager not available in this context — cannot reach the reactor-project Switchboard.",
    );
  }
  const instances = services.list("reactor-project");
  const live = instances.find(
    (i) =>
      sameProjectPath(i.workdir, projectPath) &&
      (i.status === "ready" || i.status === "starting"),
  );
  if (!live) {
    throw new Error(
      formatLines(
        `Reactor project "${projectLabel}" is not running. Start it with \`reactor-project-start ${projectLabel}\`.`,
        runningProjectsHint(instances),
      ),
    );
  }
  const switchboardUrl = live.endpoints?.["vetra-switchboard"];
  if (!switchboardUrl) {
    throw new Error(
      `Reactor project "${projectLabel}" is starting up — Switchboard endpoint not yet captured. Retry shortly.`,
    );
  }
  return {
    switchboardUrl,
    connectUrl: live.endpoints?.["vetra-studio"],
    driveId: getPreviewDriveId(projectPath),
  };
}

// Deterministically bring the reactor-project to "ready" (Switchboard up) so
// preview tools don't error/retry on a still-starting instance.

// Starts one if none is registered (`services.start` blocks until ready); the
// poll covers an instance already starting via the spec-change auto-start trigger.
export async function ensureReactorProjectReady(
  services: ServiceManager | undefined,
  projectPath: string,
  opts?: { startParams?: Record<string, unknown>; timeoutMs?: number },
): Promise<void> {
  if (!services) return;
  const ready = () => {
    const inst = services
      .list("reactor-project")
      .find((i) => sameProjectPath(i.workdir, projectPath));
    return inst?.status === "ready" && Boolean(inst.endpoints?.["vetra-switchboard"]);
  };
  if (ready()) return;

  const starting = services
    .list("reactor-project")
    .some((i) => sameProjectPath(i.workdir, projectPath) && (i.status === "ready" || i.status === "starting"));
  if (!starting) {
    try {
      await services.start("reactor-project", {
        workdir: projectPath,
        cwd: projectPath,
        params: opts?.startParams,
      });
    } catch (err) {
      // Surface, don't swallow — a start failure here (e.g. "max instances")
      // otherwise looks like a mysterious "not running" downstream.
      console.error(`[ensure-ready] services.start failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const deadline = Date.now() + (opts?.timeoutMs ?? 45_000);
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Mint a bearer token for the preview reactor from the agent's authorized Renown
 * identity, or undefined when the agent isn't authorized. The token's address is
 * the user's wallet (delegated via the studio "Authorize agent" button), so an
 * auth-enabled preview reactor accepts the write when that wallet is an admin or
 * has a grant. Undefined → caller hits the reactor anonymously, which only works
 * when the preview reactor runs without auth.
 *
 * Mint from the daemon `workdir`, NOT the reactor-project path: the credential
 * is keyed to the daemon's identity (`<workdir>/.ph/.renown.json`).
 */
export async function getPreviewAuthToken(
  workdir: string,
  config: Pick<Config, "cloudSwitchboardUrl" | "cloudRenownUrl">,
): Promise<string | undefined> {
  const { renownUrl } = resolveCloudConfig(config);
  return (await getBearerToken(workdir, renownUrl)) ?? undefined;
}

/**
 * Enumerate the reactor-project instances currently running, labelled by
 * workdir basename (what `--project` accepts). Returns undefined when none are
 * live so the caller's leading message stands alone.
 */
function runningProjectsHint(
  instances: ReturnType<ServiceManager["list"]>,
): string | undefined {
  const running = instances
    .filter(
      (i) =>
        i.workdir && (i.status === "ready" || i.status === "starting"),
    )
    .map((i) => path.basename(i.workdir as string))
    .sort();
  if (running.length === 0) return undefined;
  return `Running reactor projects: ${running.join(", ")}`;
}

/**
 * Path to a preview document inside a reactor-project's Connect. `?embed=1`
 * strips Connect's outer chrome. Single source for the URL shape — used by
 * the preview-server resolver and the spec-preview-show command.
 */
export function buildPreviewDocPath(driveId: string, doc: string): string {
  return `/d/${driveId}/${encodeURIComponent(doc)}?embed=1`;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: ReadonlyArray<string | number> }>;
}

/**
 * Turn a reactor "Forbidden: insufficient permissions" GraphQL error into chat
 * guidance the agent can relay verbatim. The reactor enforces auth only when
 * launched with it on (it's off by default), so this fires reactively — the
 * caller hits the reactor and we translate only when it actually rejects.
 *
 * Branches on whether a token was attached: no token → the agent isn't
 * authorized (the actionable fix); token present → the authorized identity
 * simply lacks rights on the drive.
 */
function authGuidance(rawMessages: string, token: string | undefined): string {
  if (token) {
    return (
      "The preview reactor rejected this request: the authorized identity " +
      "lacks permission on this drive. It must be an admin (in the launch " +
      "ADMINS list) or be granted write access. Verify the authorized wallet, " +
      "then retry."
    );
  }
  return (
    "The preview reactor requires authorization and the agent is not " +
    "authorized to act for the user. Ask the user to click \"Authorize " +
    "agent\" in the Vetra Studio header and approve with their wallet, then " +
    "retry this step. " +
    `(reactor said: ${rawMessages})`
  );
}

function isPermissionError(messages: string): boolean {
  return /forbidden|insufficient permissions/i.test(messages);
}

/**
 * Execute a GraphQL operation against the reactor-project Switchboard.
 * Throws on transport failure or GraphQL errors — the operation is the unit of
 * work, so partial success isn't useful here.
 */
async function gqlRequest<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GraphQL request to ${url} failed: ${response.status} ${response.statusText}${body ? `\n${body}` : ""}`,
    );
  }
  const payload = (await response.json()) as GraphQLResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    const messages = payload.errors.map((e) => e.message).join("; ");
    if (isPermissionError(messages)) {
      throw new Error(authGuidance(messages, token));
    }
    throw new Error(`GraphQL error: ${messages}`);
  }
  if (payload.data === undefined) {
    throw new Error(`GraphQL response missing data field`);
  }
  return payload.data;
}

type PreviewDocumentRow = {
  id: string;
  slug: string | null;
  name: string;
  documentType: string;
  revisionsList: { scope: string; revision: number }[];
};

type PreviewDocumentFull = PreviewDocumentRow & {
  state: Record<string, unknown>;
  preferredEditor: string | null;
};

const FIND_DOCUMENTS_QUERY = /* GraphQL */ `
  query FindPreviewDocuments($search: SearchFilterInput) {
    findDocuments(search: $search) {
      items {
        id
        slug
        name
        documentType
        revisionsList { scope revision }
      }
    }
  }
`;

const GET_DOCUMENT_QUERY = /* GraphQL */ `
  query GetPreviewDocument($identifier: String!) {
    document(identifier: $identifier) {
      document {
        id
        slug
        name
        documentType
        preferredEditor
        state
        revisionsList { scope revision }
      }
    }
  }
`;

const CREATE_EMPTY_DOCUMENT_MUTATION = /* GraphQL */ `
  mutation CreateEmptyPreviewDocument($documentType: String!, $parentIdentifier: String) {
    createEmptyDocument(documentType: $documentType, parentIdentifier: $parentIdentifier) {
      id
      slug
      name
      documentType
      preferredEditor
      state
      revisionsList { scope revision }
    }
  }
`;

const RENAME_DOCUMENT_MUTATION = /* GraphQL */ `
  mutation RenamePreviewDocument($documentIdentifier: String!, $name: String!) {
    renameDocument(documentIdentifier: $documentIdentifier, name: $name) {
      id
      slug
      name
      documentType
      preferredEditor
      state
      revisionsList { scope revision }
    }
  }
`;

const MUTATE_DOCUMENT_MUTATION = /* GraphQL */ `
  mutation MutatePreviewDocument($documentIdentifier: String!, $actions: [JSONObject!]!) {
    mutateDocument(documentIdentifier: $documentIdentifier, actions: $actions) {
      id
      slug
      name
      documentType
      preferredEditor
      state
      revisionsList { scope revision }
    }
  }
`;

const DELETE_DOCUMENT_MUTATION = /* GraphQL */ `
  mutation DeletePreviewDocument($identifier: String!) {
    deleteDocument(identifier: $identifier)
  }
`;

const SET_PREFERRED_EDITOR_MUTATION = /* GraphQL */ `
  mutation SetPreferredEditor($documentIdentifier: String!, $preferredEditor: String) {
    setPreferredEditor(documentIdentifier: $documentIdentifier, preferredEditor: $preferredEditor) {
      id
      slug
      name
      documentType
      preferredEditor
    }
  }
`;

const FIND_DRIVES_QUERY = /* GraphQL */ `
  query FindDrives($search: SearchFilterInput) {
    findDocuments(search: $search) {
      items {
        id
        slug
        name
        documentType
        preferredEditor
        revisionsList { scope revision }
      }
    }
  }
`;

/** List all documents in the preview drive (one level deep). */
export async function listPreviewDocuments(
  switchboardUrl: string,
  driveId: string,
  token?: string,
): Promise<PreviewDocumentRow[]> {
  const data = await gqlRequest<{ findDocuments: { items: PreviewDocumentRow[] } }>(
    switchboardUrl,
    FIND_DOCUMENTS_QUERY,
    { search: { parentId: driveId } },
    token,
  );
  return data.findDocuments.items;
}

/** Fetch a single preview document by id or slug. */
export async function getPreviewDocument(
  switchboardUrl: string,
  identifier: string,
  token?: string,
): Promise<PreviewDocumentFull | null> {
  const data = await gqlRequest<{
    document: { document: PreviewDocumentFull } | null;
  }>(switchboardUrl, GET_DOCUMENT_QUERY, { identifier }, token);
  return data.document?.document ?? null;
}

/**
 * Create a new document in the preview drive by delegating instantiation to the
 * reactor. The reactor looks up `documentType` against its registered document
 * model modules at runtime, so any type the running reactor knows about works
 * — both framework spec types and document models from installed packages.
 *
 * Two round trips: `createEmptyDocument` (the schema-exposed mutation has no
 * `name` arg) followed by `renameDocument` to set the display name.
 */
export async function createEmptyPreviewDocument(
  switchboardUrl: string,
  driveId: string,
  documentType: string,
  name: string,
  token?: string,
): Promise<PreviewDocumentFull> {
  // createEmptyDocument can race the reactor's async load of a just-generated
  // document-model package. Retry on "module not found for type" for up to 5s.
  const deadline = Date.now() + 5_000;
  let created: { createEmptyDocument: PreviewDocumentFull };
  for (;;) {
    try {
      created = await gqlRequest<{ createEmptyDocument: PreviewDocumentFull }>(
        switchboardUrl,
        CREATE_EMPTY_DOCUMENT_MUTATION,
        { documentType, parentIdentifier: driveId },
        token,
      );
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        !/Document model module not found for type/.test(msg) ||
        Date.now() >= deadline
      )
        throw err;
      console.warn(
        `[spec-preview-create] ${documentType} not yet registered in the reactor; retrying (up to 5s)…`,
      );
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const renamed = await gqlRequest<{ renameDocument: PreviewDocumentFull }>(
    switchboardUrl,
    RENAME_DOCUMENT_MUTATION,
    { documentIdentifier: created.createEmptyDocument.id, name },
    token,
  );
  return renamed.renameDocument;
}

/**
 * Apply actions to an existing preview document via the document model reducer.
 *
 * The reactor's reducer pipeline copies `action.timestampUtcMs` straight onto
 * the operation without a fallback (see `operationFromAction` in
 * `@powerhousedao/shared/document-model`); a missing timestamp lands in the
 * Kysely store as `new Date(undefined)`, which throws "Invalid time value" when
 * Kysely serialises it. Action `id` is similarly trusted to be present. We
 * therefore stamp both fields here, where the action enters the GraphQL
 * boundary, so callers can keep passing minimal `{type, input, scope?}` shapes.
 */
export async function mutatePreviewDocument(
  switchboardUrl: string,
  documentIdentifier: string,
  actions: ReadonlyArray<Record<string, unknown>>,
  token?: string,
): Promise<PreviewDocumentFull> {
  const nowIso = new Date().toISOString();
  const stamped = actions.map((a) => ({
    ...a,
    id: typeof a.id === "string" && a.id ? a.id : crypto.randomUUID(),
    timestampUtcMs:
      typeof a.timestampUtcMs === "string" && a.timestampUtcMs
        ? a.timestampUtcMs
        : nowIso,
    scope: typeof a.scope === "string" && a.scope ? a.scope : "global",
  }));
  const data = await gqlRequest<{ mutateDocument: PreviewDocumentFull }>(
    switchboardUrl,
    MUTATE_DOCUMENT_MUTATION,
    { documentIdentifier, actions: stamped },
    token,
  );
  return data.mutateDocument;
}

/** Remove a document from the preview drive. */
export async function deletePreviewDocument(
  switchboardUrl: string,
  identifier: string,
  token?: string,
): Promise<boolean> {
  const data = await gqlRequest<{ deleteDocument: boolean }>(
    switchboardUrl,
    DELETE_DOCUMENT_MUTATION,
    { identifier },
    token,
  );
  return data.deleteDocument;
}

/**
 * Resolve a preview document by display name, slug, or id (in that priority
 * order). Throws on ambiguous matches and on no-match — the error message
 * surfaces the available names so a caller can self-correct.
 */
export async function findPreviewByName(
  switchboardUrl: string,
  driveId: string,
  name: string,
  token?: string,
): Promise<PreviewDocumentRow> {
  const items = await listPreviewDocuments(switchboardUrl, driveId, token);
  /* Match priority: name → slug → id. First non-empty match set wins so a
   * name collision with a slug doesn't surface as ambiguity. Empty slugs
   * (rare; defensive) are skipped so a caller passing `""` can't match. */
  const strategies: Array<(row: PreviewDocumentRow) => boolean> = [
    (r) => r.name === name,
    (r) => !!r.slug && r.slug === name,
    (r) => r.id === name,
  ];
  for (const pred of strategies) {
    const matches = items.filter(pred);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `Multiple preview documents match "${name}" — name/slug/id must be unique.`,
      );
    }
  }
  const candidates = items.map((r) => r.name);
  throw unknownValueError({
    subject: "preview document",
    value: name,
    candidates,
  });
}

export type {
  PreviewDocumentRow,
  PreviewDocumentFull,
};

/**
 * Drive-root preview path (no document). Used when the preview target is a
 * drive (e.g. an app) rather than a single document.
 *
 * `driveRemoteUrl` (a `<switchboard>/d/<driveId>` URL) is appended as a
 * `driveUrl` query param so Connect registers the drive on load via
 * `addRemoteDrive` (see `apps/connect/.../store/reactor.ts` `getDriveUrl`).
 * Without it, a drive Connect doesn't already know about isn't openable and the
 * URL bounces to the drive picker.
 */
export function buildPreviewDriveRootPath(
  driveId: string,
  driveRemoteUrl?: string,
): string {
  const base = `/d/${driveId}?embed=1`;
  return driveRemoteUrl
    ? `${base}&driveUrl=${encodeURIComponent(driveRemoteUrl)}`
    : base;
}

/**
 * Build the remote drive URL Connect's `addRemoteDrive` expects
 * (`<switchboard-origin>/d/<driveId>`) from a Switchboard GraphQL URL.
 */
export function driveRemoteUrl(switchboardUrl: string, driveId: string): string {
  return `${switchboardUrl.replace(/\/graphql\/?$/, "")}/d/${driveId}`;
}

/**
 * Browser-facing remote-drive URL for Connect's `addRemoteDrive`. Routed
 * through the embedded proxy's switchboard mount when a proxy is configured
 * (`<proxy>/reactor-project/switchboard/d/<id>`): the captured switchboard
 * endpoint is loopback-only, which the browser can't reach on a deployed
 * Studio. Falls back to the direct switchboard origin when there is no proxy.
 */
export function browserDriveRemoteUrl(args: {
  driveId: string;
  proxyUrl?: string;
  switchboardUrl?: string;
}): string | undefined {
  if (args.proxyUrl) {
    return `${args.proxyUrl.replace(/\/+$/, "")}${REACTOR_PROJECT_SWITCHBOARD_PROXY_PATH}/d/${args.driveId}`;
  }
  if (args.switchboardUrl) {
    return driveRemoteUrl(args.switchboardUrl, args.driveId);
  }
  return undefined;
}

type PreviewDriveRow = {
  id: string;
  slug: string | null;
  name: string;
  documentType: string;
  preferredEditor: string | null;
  revisionsList: { scope: string; revision: number }[];
};

/**
 * Set a drive's preferredEditor (the app editor's config.id Connect uses to
 * render the drive). Returns the persisted value.
 *
 * NOTE: this binding lives in `header.meta` and is **wiped by a subsequent
 * `addFile`** (adding a document to the drive re-materializes the drive header
 * without meta — confirmed empirically). So after populating an app's preview
 * drive you must call this AGAIN (see `spec-preview-show --app`).
 */
export async function setDrivePreferredEditor(
  switchboardUrl: string,
  driveId: string,
  preferredEditor: string,
  token?: string,
): Promise<string | null> {
  const data = await gqlRequest<{
    setPreferredEditor: { preferredEditor: string | null };
  }>(
    switchboardUrl,
    SET_PREFERRED_EDITOR_MUTATION,
    {
      documentIdentifier: driveId,
      preferredEditor,
    },
    token,
  );
  return data.setPreferredEditor.preferredEditor ?? null;
}

/**
 * Resolve an app's editor `config.id` (the value Connect renders a drive with)
 * from `<projectPath>/powerhouse.manifest.json` `apps[]`, by id or display name.
 * Throws with the available app ids if not found.
 */
export function resolveAppEditorId(
  projectPath: string,
  appNameOrId: string,
): string {
  const manifestPath = path.join(projectPath, "powerhouse.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `powerhouse.manifest.json not found at ${manifestPath}. Run spec-generate on the app spec first.`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    apps?: Array<{ id: string; name?: string }>;
  };
  const apps = manifest.apps ?? [];
  const byId = apps.find((a) => a.id === appNameOrId);
  if (byId) return byId.id;
  const byName = apps.find(
    (a) => a.name?.toLowerCase() === appNameOrId.toLowerCase(),
  );
  if (byName) return byName.id;
  const candidates = apps.map((a) => a.id);
  throw new Error(
    `App "${appNameOrId}" not found in powerhouse.manifest.json apps[]. Available: ${candidates.join(", ") || "(none)"}`,
  );
}

/**
 * Create a top-level drive bound to an app (preferredEditor = app editor
 * config.id). createEmptyDocument → renameDocument → setPreferredEditor (last).
 * The binding is set last because renameDocument resets header.meta. Note it is
 * still wiped by later addFile calls when the drive is populated — re-assert it
 * at show time via `spec-preview-show --app` (see setDrivePreferredEditor).
 */
export async function createPreviewDrive(
  switchboardUrl: string,
  name: string,
  preferredEditor?: string,
  token?: string,
): Promise<{ id: string; name: string; preferredEditor: string | null }> {
  const created = await gqlRequest<{ createEmptyDocument: PreviewDocumentFull }>(
    switchboardUrl,
    CREATE_EMPTY_DOCUMENT_MUTATION,
    { documentType: "powerhouse/document-drive", parentIdentifier: null },
    token,
  );
  const driveId = created.createEmptyDocument.id;
  const renamed = await gqlRequest<{ renameDocument: PreviewDocumentFull }>(
    switchboardUrl,
    RENAME_DOCUMENT_MUTATION,
    { documentIdentifier: driveId, name },
    token,
  );
  const resolvedEditor = preferredEditor
    ? await setDrivePreferredEditor(switchboardUrl, driveId, preferredEditor, token)
    : null;
  return {
    id: driveId,
    name: renamed.renameDocument.name,
    preferredEditor: resolvedEditor,
  };
}

/**
 * Find an existing top-level drive whose `preferredEditor` matches. Returns null
 * if none. Keys idempotent preview-drive reuse on the app's editor id (one drive
 * per app) rather than the display name, so re-running with a different
 * `--name`/`--app` spelling still reuses the same drive.
 *
 * Filters by `SearchFilterInput.type` — the field is `type`, not `documentType`
 * (see reactor-api `schema.graphql`). This is the same predicate `reactor-mcp`'s
 * `getDrives` uses to enumerate drives (`client.find({ type: DRIVE_TYPE })`).
 */
export async function findPreviewDriveByPreferredEditor(
  switchboardUrl: string,
  preferredEditor: string,
  token?: string,
): Promise<PreviewDriveRow | null> {
  const data = await gqlRequest<{ findDocuments: { items: PreviewDriveRow[] } }>(
    switchboardUrl,
    FIND_DRIVES_QUERY,
    { search: { type: "powerhouse/document-drive" } },
    token,
  );
  const drives = data.findDocuments.items;
  const match = drives.find((d) => d.preferredEditor === preferredEditor);
  return match ?? null;
}
