/**
 * Helpers for interacting with the preview drive of a running reactor-project.
 *
 * A reactor-project is the Preview run (the package's `preview` host in the
 * project); its switchboard member serves the preview drive (declared slug
 * `preview`). The
 * service reads the drive's id and URL, and the members' URLs, from the run
 * record (`services/reactor-project.ts` `previewEndpoints`).
 *
 * The `spec-preview-*` commands target this drive through the project's
 * Switchboard GraphQL endpoint rather than the on-disk reactor store — the
 * running process owns the storage and concurrent file writes are unsafe.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ServiceInstanceStatus, ServiceManager } from "@powerhousedao/clint";
import { getBearerToken } from "../auth/renown.js";
import { resolveCloudConfig } from "../cloud/config.js";
import type { Config } from "../framework.js";
import { unknownValueError } from "./cli-errors.js";

/** The preview drive's id, as the ready instance reports it. */
export function previewDriveIdOf(
  instance: Pick<ServiceInstanceStatus, "endpoints">,
): string | undefined {
  return instance.endpoints?.["vetra-preview-drive-id"];
}

/**
 * Resolve the running reactor-project instance for `projectPath` (the project
 * the Cli works in) and return the Switchboard GraphQL URL plus the preview
 * drive id.
 *
 * Errors with a runnable hint if the project's run is not live. Does not
 * attempt to start the service — lifecycle stays explicit.
 */
export function resolvePreviewEndpoint(
  services: ServiceManager | undefined,
  projectPath: string,
): { switchboardUrl: string; connectUrl: string | undefined; driveId: string } {
  if (!services) {
    throw new Error(
      "Service manager not available in this context — cannot reach the reactor-project Switchboard.",
    );
  }
  const instances = services.list("reactor-project");
  const live = instances.find(
    (i) =>
      i.workdir === projectPath &&
      (i.status === "ready" || i.status === "starting"),
  );
  if (!live) {
    throw new Error(
      "The Preview run is not running: start it with `reactor-project-start`.",
    );
  }
  const switchboardUrl = live.endpoints?.["vetra-switchboard"];
  const driveId = previewDriveIdOf(live);
  if (!switchboardUrl || !driveId) {
    throw new Error(
      "The Preview run is starting up — its run record is not live yet. Retry shortly.",
    );
  }
  return {
    switchboardUrl,
    connectUrl: live.endpoints?.["vetra-studio"],
    driveId,
  };
}

/**
 * Mint a bearer token for the preview reactor from the agent's authorized Renown
 * identity, or undefined when the agent isn't authorized. The token's address is
 * the user's wallet (delegated via the studio "Authorize agent" button), so an
 * auth-enabled preview reactor accepts the write when that wallet is an admin or
 * has a grant. Undefined → caller hits the reactor anonymously, which only works
 * when the preview reactor runs without auth.
 *
 * Mint from the daemon `workdir`, NOT the reactor-project path: the session is
 * the Studio's agent's (`<workdir>/.ph/sessions/`). A pseudonym's session gets
 * none: the preview's store does not know its credential.
 */
export async function getPreviewAuthToken(
  workdir: string,
  config: Pick<Config, "cloudSwitchboardUrl" | "cloudRenownUrl">,
): Promise<string | undefined> {
  const { renownUrl } = resolveCloudConfig(config);
  return (await getBearerToken(workdir, renownUrl)) ?? undefined;
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
  query GetPreviewDocument($idOrSlug: String!) {
    document(idOrSlug: $idOrSlug) {
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
  mutation CreateEmptyPreviewDocument($documentType: String!, $parentIdOrSlug: String) {
    createEmptyDocument(documentType: $documentType, parentIdOrSlug: $parentIdOrSlug) {
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
  mutation RenamePreviewDocument($documentIdOrSlug: String!, $name: String!) {
    renameDocument(documentIdOrSlug: $documentIdOrSlug, name: $name) {
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
  mutation DeletePreviewDocument($idOrSlug: String!) {
    deleteDocument(idOrSlug: $idOrSlug)
  }
`;

const SET_PREFERRED_EDITOR_MUTATION = /* GraphQL */ `
  mutation SetPreferredEditor($documentIdOrSlug: String!, $preferredEditor: String) {
    setPreferredEditor(documentIdOrSlug: $documentIdOrSlug, preferredEditor: $preferredEditor) {
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
  }>(switchboardUrl, GET_DOCUMENT_QUERY, { idOrSlug: identifier }, token);
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
        { documentType, parentIdOrSlug: driveId },
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
    { documentIdOrSlug: created.createEmptyDocument.id, name },
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
    { idOrSlug: identifier },
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
 * (`<switchboard-origin>/d/<driveId>`) from a Switchboard GraphQL URL. The
 * browser fetches it, so it reaches the project switchboard directly: the
 * preview is local to this machine.
 */
export function driveRemoteUrl(switchboardUrl: string, driveId: string): string {
  return `${switchboardUrl.replace(/\/graphql\/?$/, "")}/d/${driveId}`;
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
      documentIdOrSlug: driveId,
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
    { documentType: "powerhouse/document-drive", parentIdOrSlug: null },
    token,
  );
  const driveId = created.createEmptyDocument.id;
  const renamed = await gqlRequest<{ renameDocument: PreviewDocumentFull }>(
    switchboardUrl,
    RENAME_DOCUMENT_MUTATION,
    { documentIdOrSlug: driveId, name },
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
