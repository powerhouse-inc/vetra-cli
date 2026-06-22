import type { EnvironmentSummary, ListScope } from "./types.js";

type GqlResponse<T> = { data?: T; errors?: Array<{ message?: string }> };

async function gql<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors[0].message ?? "GraphQL error");
  }
  return json.data as T;
}

/** List the caller's environments. The `scope` is enforced server-side. */
export async function fetchMyEnvironments(
  endpoint: string,
  scope: ListScope,
  token?: string | null,
): Promise<EnvironmentSummary[]> {
  const data = await gql<{ myEnvironments: EnvironmentSummary[] }>(
    endpoint,
    `query ($scope: ListScope!) {
      myEnvironments(scope: $scope) {
        id name subdomain customDomain status owner createdBy
      }
    }`,
    { scope },
    token,
  );
  return data.myEnvironments;
}

/**
 * Keep only the caller's own environments: owned by me, or unclaimed (owner
 * null) but created by me. The MINE scope is enforced server-side but still
 * returns unclaimed envs, so this trims the leak.
 */
export function filterOwn(
  items: EnvironmentSummary[],
  viewer: string | undefined,
): EnvironmentSummary[] {
  const me = viewer?.toLowerCase() ?? null;
  if (me === null) return [];
  return items.filter((e) => {
    const owner = e.owner?.toLowerCase() ?? null;
    const createdBy = e.createdBy?.toLowerCase() ?? null;
    return owner === me || (owner === null && createdBy === me);
  });
}
