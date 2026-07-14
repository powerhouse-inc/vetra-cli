import { cloudGraphqlEndpoint } from "./cloudClient.js";

/** Slug of the Vetra GitHub App; drives the install URL. */
const GITHUB_APP_SLUG = "vetra-studio";

/** Where to send the user to install the app on their account. */
export function githubInstallUrl(): string {
  return `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;
}

export type GithubConnection = {
  environmentId: string;
  repoFullName: string;
  repoUrl: string;
  createdAt: string;
};

export type GithubConnectionStatus = {
  connected: boolean;
  connection: GithubConnection | null;
};

/** Connection + identity link + live install state (see backend GithubStatus). */
export type GithubStatus = {
  connected: boolean;
  connection: GithubConnection | null;
  githubLogin: string | null;
  appInstalled: boolean;
  /** Push health for a connected env: can the installation reach the repo?
   * Null when not connected or GitHub unreachable. Absent on older backends. */
  repoAccessible?: boolean | null;
};

export type GithubDeviceFlow = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

/** Result of one connectGithub poll, mapped from the backend's status/error codes. */
export type ConnectResult =
  | { status: "connected"; connection: GithubConnection | null }
  | { status: "pending" }
  | { status: "slowDown" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "repoExists" }
  | { status: "appNotInstalled" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

type PollStatus = Exclude<ConnectResult["status"], "connected" | "error">;

const CONNECT_ERROR_STATUS: Partial<Record<string, PollStatus>> = {
  AUTHORIZATION_PENDING: "pending",
  SLOW_DOWN: "slowDown",
  DEVICE_CODE_EXPIRED: "expired",
  ACCESS_DENIED: "denied",
  REPO_ALREADY_EXISTS: "repoExists",
  APP_NOT_INSTALLED: "appNotInstalled",
  UNAUTHENTICATED: "unauthenticated",
};

type GqlResponse<T> = {
  data?: T;
  errors?: { message?: string; extensions?: { code?: string } }[];
};

/** POSTs a GraphQL operation; returns the data and the first error code. */
async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string | null,
): Promise<{ data: T | null; errorMessage: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(cloudGraphqlEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return { data: null, errorMessage: `HTTP_${res.status}` };
    const json = (await res.json()) as GqlResponse<T>;
    const err = json.errors?.[0];
    return {
      data: json.data ?? null,
      errorMessage: err?.extensions?.code ?? err?.message ?? null,
    };
  } catch {
    return { data: null, errorMessage: "NETWORK_ERROR" };
  }
}

/** The authenticated caller's current GitHub connection. Null on failure. */
export async function myGithubConnection(
  environmentId: string,
  token: string,
): Promise<GithubConnectionStatus | null> {
  const { data } = await gql<{
    VetraGithubAuth: { myGithubConnection: GithubConnectionStatus };
  }>(
    `query ($environmentId: String!) {
      VetraGithubAuth {
        myGithubConnection(environmentId: $environmentId) {
          connected
          connection { environmentId repoFullName repoUrl createdAt }
        }
      }
    }`,
    { environmentId },
    token,
  );
  return data?.VetraGithubAuth.myGithubConnection ?? null;
}

/**
 * Connection, identity link, and live install state for the caller — lets the
 * card skip the install step for users who already installed the app. Null on
 * failure.
 */
export async function myGithubStatus(
  environmentId: string,
  token: string,
): Promise<GithubStatus | null> {
  const { data } = await gql<{
    VetraGithubAuth: { myGithubStatus: GithubStatus };
  }>(
    `query ($environmentId: String!) {
      VetraGithubAuth {
        myGithubStatus(environmentId: $environmentId) {
          connected
          connection { environmentId repoFullName repoUrl createdAt }
          githubLogin
          appInstalled
          repoAccessible
        }
      }
    }`,
    { environmentId },
    token,
  );
  return data?.VetraGithubAuth.myGithubStatus ?? null;
}

/** Result of one authorizeGithub poll. */
export type AuthorizeResult =
  | { status: "authorized"; githubLogin: string | null; appInstalled: boolean }
  | { status: "pending" }
  | { status: "slowDown" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

/**
 * One poll of device authorization: reports identity + live install state once
 * the user approves. Keep polling while pending, and while appInstalled is
 * false. The backend caches the exchanged token so connectGithub can follow
 * with the same deviceCode.
 */
export async function authorizeGithub(
  deviceCode: string,
  token: string,
): Promise<AuthorizeResult> {
  const { data, errorMessage } = await gql<{
    VetraGithubAuth: {
      authorizeGithub: { githubLogin: string | null; appInstalled: boolean };
    };
  }>(
    `mutation ($deviceCode: String!) {
      VetraGithubAuth {
        authorizeGithub(deviceCode: $deviceCode) { githubLogin appInstalled }
      }
    }`,
    { deviceCode },
    token,
  );
  const result = data?.VetraGithubAuth.authorizeGithub;
  if (result) return { status: "authorized", ...result };
  switch (errorMessage) {
    case "AUTHORIZATION_PENDING":
      return { status: "pending" };
    case "SLOW_DOWN":
      return { status: "slowDown" };
    case "DEVICE_CODE_EXPIRED":
      return { status: "expired" };
    case "ACCESS_DENIED":
      return { status: "denied" };
    case "UNAUTHENTICATED":
      return { status: "unauthenticated" };
    default:
      return { status: "error", message: errorMessage ?? "UNKNOWN" };
  }
}

/** Begin device authorization. Null on failure. */
export async function startGithubDeviceFlow(
  token: string,
): Promise<GithubDeviceFlow | null> {
  const { data } = await gql<{
    VetraGithubAuth: { startGithubDeviceFlow: GithubDeviceFlow };
  }>(
    `mutation {
      VetraGithubAuth {
        startGithubDeviceFlow { deviceCode userCode verificationUri expiresIn interval }
      }
    }`,
    {},
    token,
  );
  return data?.VetraGithubAuth.startGithubDeviceFlow ?? null;
}

/**
 * Exchange the device code and, once authorized, create the repo and persist
 * the binding for the environment. Returns a discriminated result.
 */
export async function connectGithub(
  deviceCode: string,
  repoName: string,
  environmentId: string,
  token: string,
): Promise<ConnectResult> {
  const { data, errorMessage } = await gql<{
    VetraGithubAuth: { connectGithub: GithubConnectionStatus };
  }>(
    `mutation ($deviceCode: String!, $repoName: String!, $environmentId: String!) {
      VetraGithubAuth {
        connectGithub(deviceCode: $deviceCode, repoName: $repoName, environmentId: $environmentId) {
          connected
          connection { environmentId repoFullName repoUrl createdAt }
        }
      }
    }`,
    { deviceCode, repoName, environmentId },
    token,
  );

  const result = data?.VetraGithubAuth.connectGithub;
  if (result) return { status: "connected", connection: result.connection };
  if (errorMessage) {
    const mapped = CONNECT_ERROR_STATUS[errorMessage];
    return mapped
      ? { status: mapped }
      : { status: "error", message: errorMessage };
  }
  return { status: "error", message: "UNKNOWN" };
}
