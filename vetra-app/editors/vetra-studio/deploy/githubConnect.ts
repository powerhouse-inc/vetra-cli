import { resolveCloudGraphqlEndpoint } from "./cloudClient.js";

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
  REPO_EXISTS: "repoExists",
  APP_NOT_INSTALLED: "appNotInstalled",
  UNAUTHENTICATED: "unauthenticated",
};

/** Customer-readable text, with the next step, for the backend's GitHub and
 * deploy-setup error codes. */
const GITHUB_ERROR_MESSAGES: Partial<Record<string, string>> = {
  REPO_EXISTS:
    "A repository with this name already exists on GitHub. Choose another name, or connect the existing repository.",
  INSUFFICIENT_PERMISSION:
    "Vetra does not have permission to create repositories in this GitHub account. Install the Vetra GitHub app on the account or organisation with the repository Administration permission, then try again.",
  GITHUB_NOT_CONNECTED:
    "Your GitHub connection has expired or was removed. Reconnect GitHub, then try again.",
  GITHUB_UNAVAILABLE: "GitHub is not responding. Try again in a minute.",
  ORG_POLICY:
    "A policy of your GitHub organisation does not allow this. Ask an owner of the organisation to allow it, then try again.",
  DEPLOY_SETUP_FAILED:
    "Setting up the deployment failed after the repository was created. Everything was rolled back; try again.",
};

/** The message shown for a backend error code (`reason`: GitHub's own words). */
export function githubErrorMessage(
  code: string | null,
  reason?: string | null,
): string {
  if (code === "REPO_NAME_INVALID")
    return reason
      ? `GitHub did not accept this repository name (${reason}). Choose another name.`
      : "GitHub did not accept this repository name. Choose another name.";
  const known = code ? GITHUB_ERROR_MESSAGES[code] : undefined;
  if (known) return known;
  return `Something went wrong while connecting GitHub (${code ?? "UNKNOWN"}). Try again in a moment.`;
}

type GqlResponse<T> = {
  data?: T;
  errors?: {
    message?: string;
    extensions?: { code?: string; reason?: string };
  }[];
};

/** POSTs a GraphQL operation; returns the data and the first error code. */
async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string | null,
): Promise<{
  data: T | null;
  errorMessage: string | null;
  errorReason?: string | null;
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(await resolveCloudGraphqlEndpoint(), {
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
      errorReason: err?.extensions?.reason ?? null,
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
      return { status: "error", message: githubErrorMessage(errorMessage) };
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
  const { data, errorMessage, errorReason } = await gql<{
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
      : {
          status: "error",
          message: githubErrorMessage(errorMessage, errorReason),
        };
  }
  return { status: "error", message: githubErrorMessage(null) };
}
