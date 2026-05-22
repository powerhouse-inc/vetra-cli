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
import type { ServiceManager } from "@powerhousedao/ph-clint";
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { unknownValueError } from "./cli-errors.js";

const PREVIEW_DRIVE_PREFIX = "preview";

/**
 * Compute the preview drive id for a reactor-project rooted at `projectPath`.
 *
 * Mirrors `generateProjectDriveId("preview")` from
 * `monorepo/clis/ph-cli/src/utils.ts`: short sha256 of the project root path.
 * Keep the two implementations in sync — diverging here silently sends
 * mutations to a non-existent drive.
 */
export function getPreviewDriveId(projectPath: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(projectPath)
    .digest("hex")
    .slice(0, 8);
  return `${PREVIEW_DRIVE_PREFIX}-${hash}`;
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
): { switchboardUrl: string; driveId: string } {
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
  const endpoint = live.endpoints?.["vetra-switchboard"];
  if (!endpoint) {
    throw new Error(
      `Reactor project "${projectLabel}" is starting up — Switchboard endpoint not yet captured. Retry shortly.`,
    );
  }
  return {
    switchboardUrl: endpoint,
    driveId: getPreviewDriveId(projectPath),
  };
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

const CREATE_DOCUMENT_MUTATION = /* GraphQL */ `
  mutation CreatePreviewDocument($document: JSONObject!, $parentIdentifier: String) {
    createDocument(document: $document, parentIdentifier: $parentIdentifier) {
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

/** Create a new document in the preview drive. */
export async function createPreviewDocument(
  switchboardUrl: string,
  driveId: string,
  document: PHDocument,
): Promise<PreviewDocumentFull> {
  const data = await gqlRequest<{ createDocument: PreviewDocumentFull }>(
    switchboardUrl,
    CREATE_DOCUMENT_MUTATION,
    { document, parentIdentifier: driveId },
  );
  return data.createDocument;
}

/** Apply actions to an existing preview document via the document model reducer. */
export async function mutatePreviewDocument(
  switchboardUrl: string,
  documentIdentifier: string,
  actions: ReadonlyArray<unknown>,
): Promise<PreviewDocumentFull> {
  const data = await gqlRequest<{ mutateDocument: PreviewDocumentFull }>(
    switchboardUrl,
    MUTATE_DOCUMENT_MUTATION,
    { documentIdentifier, actions },
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
