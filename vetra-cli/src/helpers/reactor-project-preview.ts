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
import type { ServiceManager } from "@powerhousedao/ph-clint";
import { unknownValueError } from "./cli-errors.js";

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
      i.workdir === projectPath &&
      (i.status === "ready" || i.status === "starting"),
  );
  if (!live) {
    throw new Error(
      `Reactor project "${projectLabel}" is not running. Start it with \`reactor-project-start ${projectLabel}\`.`,
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
 * Execute a GraphQL operation against the reactor-project Switchboard.
 * Throws on transport failure or GraphQL errors — the operation is the unit of
 * work, so partial success isn't useful here.
 */
async function gqlRequest<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

/** List all documents in the preview drive (one level deep). */
export async function listPreviewDocuments(
  switchboardUrl: string,
  driveId: string,
): Promise<PreviewDocumentRow[]> {
  const data = await gqlRequest<{ findDocuments: { items: PreviewDocumentRow[] } }>(
    switchboardUrl,
    FIND_DOCUMENTS_QUERY,
    { search: { parentId: driveId } },
  );
  return data.findDocuments.items;
}

/** Fetch a single preview document by id or slug. */
export async function getPreviewDocument(
  switchboardUrl: string,
  identifier: string,
): Promise<PreviewDocumentFull | null> {
  const data = await gqlRequest<{
    document: { document: PreviewDocumentFull } | null;
  }>(switchboardUrl, GET_DOCUMENT_QUERY, { identifier });
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
): Promise<PreviewDocumentFull> {
  const created = await gqlRequest<{ createEmptyDocument: PreviewDocumentFull }>(
    switchboardUrl,
    CREATE_EMPTY_DOCUMENT_MUTATION,
    { documentType, parentIdentifier: driveId },
  );
  const renamed = await gqlRequest<{ renameDocument: PreviewDocumentFull }>(
    switchboardUrl,
    RENAME_DOCUMENT_MUTATION,
    { documentIdentifier: created.createEmptyDocument.id, name },
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
  );
  return data.mutateDocument;
}

/** Remove a document from the preview drive. */
export async function deletePreviewDocument(
  switchboardUrl: string,
  identifier: string,
): Promise<boolean> {
  const data = await gqlRequest<{ deleteDocument: boolean }>(
    switchboardUrl,
    DELETE_DOCUMENT_MUTATION,
    { identifier },
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
): Promise<PreviewDocumentRow> {
  const items = await listPreviewDocuments(switchboardUrl, driveId);
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
