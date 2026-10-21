// Renown orgs client: the one public read the Studio needs, orgMembership.
// Every failure throws RenownOrgsUnavailableError; callers (team/membership.ts)
// fail closed on it and never treat it as "not a member".

export type OrgRole = "OWNER" | "ADMIN" | "PUBLISHER" | "MEMBER";
export interface OrgScope {
  all: boolean;
  appDids: string[];
}
export interface OrgMembership {
  role: OrgRole;
  status: string;
  effectiveScope: OrgScope;
}

export class RenownOrgsUnavailableError extends Error {
  override name = "RenownOrgsUnavailableError";
}

export interface RenownOrgsDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const QUERY = `query StudioOrgMembership($orgId: String!, $address: String!) {
  orgMembership(orgId: $orgId, address: $address) { role status effectiveScope { all appDids } }
}`;

const ROLES: readonly string[] = ["OWNER", "ADMIN", "PUBLISHER", "MEMBER"];

function parseMembership(raw: unknown): OrgMembership | null {
  if (raw === null) return null;
  const m = raw as Partial<OrgMembership> | undefined;
  const scope = m?.effectiveScope;
  if (
    !m ||
    typeof m.role !== "string" ||
    !ROLES.includes(m.role) ||
    typeof m.status !== "string" ||
    !scope ||
    typeof scope.all !== "boolean" ||
    !Array.isArray(scope.appDids)
  ) {
    throw new RenownOrgsUnavailableError("malformed orgMembership response");
  }
  return {
    role: m.role,
    status: m.status,
    effectiveScope: { all: scope.all, appDids: scope.appDids.map(String) },
  };
}

/** The membership of `address` in `orgId` (any status), or null when none. */
export async function fetchOrgMembership(
  url: string,
  orgId: string,
  address: string,
  deps: RenownOrgsDeps = {},
): Promise<OrgMembership | null> {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        query: QUERY,
        variables: { orgId, address: address.toLowerCase() },
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5_000),
    });
  } catch (err) {
    throw new RenownOrgsUnavailableError(
      `network: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let body: { data?: { orgMembership?: unknown } | null; errors?: unknown[] } | null;
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = null;
  }
  if (!res.ok || !body || body.errors?.length || !body.data || !("orgMembership" in body.data)) {
    throw new RenownOrgsUnavailableError(`HTTP ${res.status}`);
  }
  return parseMembership(body.data.orgMembership);
}
