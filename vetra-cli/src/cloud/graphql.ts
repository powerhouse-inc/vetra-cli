/**
 * Cloud switchboard GraphQL reads. Port of
 * vetra-app/editors/vetra-studio/deploy/cloudGraphql.ts for Node — plain fetch,
 * no browser dependencies.
 */

/** Caller-scoped environment summary from the observability subgraph's
 * `myEnvironments` query. The server enforces the scope, so we only receive the
 * caller's own environments. */
export type EnvironmentSummary = {
  id: string;
  name: string | null;
  subdomain: string | null;
  customDomain: string | null;
  status: string | null;
  owner: string | null;
  /** Legacy creator column — keeps a just-created env (before SET_OWNER lands)
   * in the creator's MINE view. */
  createdBy: string | null;
};

export type ListScope = "MINE" | "ALL";

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
