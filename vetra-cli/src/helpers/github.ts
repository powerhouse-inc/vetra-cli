import { getBearerToken } from '../auth/renown.js';
import { resolveCloudConfig, resolveCloudGraphqlEndpoint } from '../cloud/config.js';
import {
  GITHUB_NOT_CONNECTED_CODE,
  cloudPushToken,
  isUnsupported,
  redact,
  type CloudContext,
  type PushToken as PushTokenWithRemote,
} from '../launch/cloud-launch.js';
import { LaunchError } from '../launch/errors.js';

const NOT_AUTHORIZED =
  "Not authorized — the agent can't act as the user until they connect their " +
  "Renown identity to it. Ask the user to click 'Authorize agent' in the top bar " +
  'of Vetra Studio and approve in their wallet, then retry.';

type GqlResponse<T> = {
  data?: T;
  errors?: { message?: string; extensions?: { code?: string } }[];
};

/** An error code returned by the vetra-github-auth subgraph. */
export class GithubAuthError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'GithubAuthError';
  }
}

export type GithubConnection = {
  environmentId: string;
  repoFullName: string;
  repoUrl: string;
  createdAt: string;
};

export type ConnectionStatus = {
  connected: boolean;
  connection: GithubConnection | null;
};

export type PushToken = { token: string; expiresAt: string };

async function gql<T>(
  switchboardUrl: string,
  bearer: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(switchboardUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new GithubAuthError('HTTP_ERROR', `${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as GqlResponse<T>;
  const err = body.errors?.[0];
  if (err) {
    throw new GithubAuthError(err.extensions?.code ?? 'GRAPHQL_ERROR', err.message);
  }
  if (!body.data) throw new GithubAuthError('NO_DATA', 'GraphQL response had no data');
  return body.data;
}

/** The repo (if any) this environment is connected to. */
export async function fetchConnection(
  switchboardUrl: string,
  environmentId: string,
  bearer: string,
): Promise<ConnectionStatus> {
  const data = await gql<{ VetraGithubAuth: { myGithubConnection: ConnectionStatus } }>(
    switchboardUrl,
    bearer,
    `query ($environmentId: String!) {
      VetraGithubAuth {
        myGithubConnection(environmentId: $environmentId) {
          connected
          connection { environmentId repoFullName repoUrl createdAt }
        }
      }
    }`,
    { environmentId },
  );
  return data.VetraGithubAuth.myGithubConnection;
}

/**
 * Mint a short-lived installation push token for `environmentId`. Throws
 * {@link GithubAuthError} with the backend code (NOT_CONNECTED,
 * REINSTALL_REQUIRED, UNAUTHENTICATED) on failure.
 */
export async function fetchPushToken(
  switchboardUrl: string,
  environmentId: string,
  bearer: string,
): Promise<PushToken> {
  const data = await gql<{ VetraGithubAuth: { getPushToken: PushToken } }>(
    switchboardUrl,
    bearer,
    `query ($environmentId: String!) {
      VetraGithubAuth { getPushToken(environmentId: $environmentId) { token expiresAt } }
    }`,
    { environmentId },
  );
  return data.VetraGithubAuth.getPushToken;
}

/**
 * The numeric GitHub user id of the app's bot account (`<slug>[bot]`), used to
 * form the bot's noreply commit email. Public, unauthenticated.
 */
export async function fetchBotUserId(slug: string): Promise<number> {
  const login = `${slug}[bot]`;
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vetra' },
  });
  if (!res.ok) {
    throw new Error(`Could not resolve bot user ${login}: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { id: number };
  return body.id;
}

/** POSIX shell single-quote a value so it is safe to embed in a command. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Env var the git credential helper reads the installation token from. */
export const GH_TOKEN_ENV = 'VETRA_GH_TOKEN';

/** A `git` invocation that authenticates via a credential helper reading the
 * token from {@link GH_TOKEN_ENV} (username `x-access-token`). Pass the token to
 * the process with `{ env: { [GH_TOKEN_ENV]: token } }`. */
export function authedGit(): string {
  const helper =
    '!f() { echo username=x-access-token; echo "password=$' + GH_TOKEN_ENV + '"; }; f';
  return `git -c credential.helper= -c credential.helper=${shq(helper)}`;
}

export type RepoRemote = {
  token: string;
  repoFullName: string;
  cleanUrl: string;
};

/**
 * Resolve the environment's connected repo and a fresh installation token as a
 * tokenized HTTPS git remote URL, usable for both fetch/pull and push.
 */
export async function resolveRepoRemote(ctx: {
  workdir: string;
  config: { environmentId?: string; cloudSwitchboardUrl?: string; cloudRenownUrl?: string };
}): Promise<RepoRemote> {
  const environmentId = ctx.config.environmentId;
  if (!environmentId) {
    throw new Error('No environment id configured (set VETRA_ENVIRONMENT_ID).');
  }
  const { renownUrl } = resolveCloudConfig(ctx.config);
  const graphqlEndpoint = resolveCloudGraphqlEndpoint(ctx.config);
  const bearer = await getBearerToken(ctx.workdir, renownUrl);
  if (!bearer) throw new Error(NOT_AUTHORIZED);
  const status = await fetchConnection(graphqlEndpoint, environmentId, bearer);
  if (!status.connected || !status.connection) {
    throw new Error(
      "This studio is not connected to GitHub yet — connect a repository from the studio's Deploy tab first (optional).",
    );
  }
  const repoFullName = status.connection.repoFullName;
  const { token } = await fetchPushToken(graphqlEndpoint, environmentId, bearer).catch(
    (error: unknown) => {
      if (error instanceof GithubAuthError && error.code === 'APP_NOT_INSTALLED') {
        throw new Error(
          "The Vetra GitHub app isn't installed on this repo yet — install it (and select " +
            'this repo) on GitHub, then retry.',
        );
      }
      throw error;
    },
  );
  const cleanUrl = `https://github.com/${repoFullName}.git`;
  return { token, repoFullName, cleanUrl };
}

/* ------------------------------------------------------------------------ */
/* Push token for the product's repository (Task 4.3)                        */
/* ------------------------------------------------------------------------ */

/** `owner/name`, as GitHub names a repository. */
const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** vetra-github-auth codes meaning the Studio has no usable earlier connection. */
const NO_EARLIER_CONNECTION = new Set(['NOT_CONNECTED', 'APP_NOT_INSTALLED', 'REINSTALL_REQUIRED']);
const EARLIER_TIMEOUT_MS = 30_000;

/** One vetra-github-auth call through the context's seams; errors are LaunchErrors without secrets. */
async function earlierGql<T>(
  ctx: CloudContext,
  bearer: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: T; code?: string }> {
  const secrets: string[] = [bearer];
  const doFetch = ctx.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(resolveCloudGraphqlEndpoint(ctx.config), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(EARLIER_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = redact(err instanceof Error ? err.message : String(err), secrets);
    throw new LaunchError('CLOUD_UNAVAILABLE', "Vetra didn't answer", `getPushToken: ${detail}`);
  }
  let body: GqlResponse<T> | null = null;
  try {
    body = (await res.json()) as GqlResponse<T>;
  } catch {
    body = null;
  }
  const first = body?.errors?.[0];
  if (first) return { code: first.extensions?.code ?? 'GRAPHQL_ERROR', data: undefined };
  if (!res.ok || !body?.data) {
    throw new LaunchError('CLOUD_UNAVAILABLE', "Vetra didn't answer", `getPushToken: HTTP ${res.status}`);
  }
  return { data: body.data };
}

/**
 * A push token from the GitHub connection the Studio made before GitHub moved
 * to the product's settings (`vetra-github-auth` `getPushToken`), for Studios
 * whose product hasn't carried that repository over yet. Null when there is
 * none (no Studio id, no sign-in, no connection, the old app is no longer on
 * the repository, or a cloud without it). The token is never logged.
 */
export async function legacyPushToken(ctx: CloudContext): Promise<PushTokenWithRemote | null> {
  const environmentId = ctx.config.environmentId?.trim();
  if (!environmentId) return null;
  const bearer = await (ctx.bearerToken
    ? ctx.bearerToken()
    : getBearerToken(ctx.workdir, resolveCloudConfig(ctx.config).renownUrl));
  if (!bearer) return null;
  const status = await earlierGql<{ VetraGithubAuth: { myGithubConnection: ConnectionStatus } }>(
    ctx,
    bearer,
    `query ($environmentId: String!) {
      VetraGithubAuth { myGithubConnection(environmentId: $environmentId) { connected connection { repoFullName } } }
    }`,
    { environmentId },
  );
  if (status.code) {
    ctx.log?.debug?.(`[github] no earlier GitHub connection (${status.code})`);
    return null;
  }
  const repo = status.data?.VetraGithubAuth.myGithubConnection;
  const repoFullName = repo?.connected ? repo.connection?.repoFullName : undefined;
  if (!repoFullName || !REPO_NAME.test(repoFullName) || repoFullName.includes('..')) return null;
  const minted = await earlierGql<{ VetraGithubAuth: { getPushToken: PushToken } }>(
    ctx,
    bearer,
    `query ($environmentId: String!) {
      VetraGithubAuth { getPushToken(environmentId: $environmentId) { token expiresAt } }
    }`,
    { environmentId },
  );
  if (minted.code) {
    if (NO_EARLIER_CONNECTION.has(minted.code)) {
      ctx.log?.debug?.(`[github] the earlier GitHub connection has no token (${minted.code})`);
      return null;
    }
    throw new LaunchError('GITHUB_TOKEN', "GitHub didn't let Vetra in", `getPushToken: ${minted.code}`);
  }
  const token = minted.data?.VetraGithubAuth.getPushToken;
  if (!token?.token) {
    throw new LaunchError('GITHUB_TOKEN', "GitHub didn't let Vetra in", 'getPushToken: no token');
  }
  return {
    token: token.token,
    expiresAt: token.expiresAt,
    remoteUrl: `https://github.com/${repoFullName}.git`,
  };
}

export interface PushTokenSources {
  studio: (ctx: CloudContext, appId: string) => Promise<PushTokenWithRemote>;
  legacy: (ctx: CloudContext) => Promise<PushTokenWithRemote | null>;
}

/**
 * The token every mirror push and fetch uses (`MirrorDeps.pushToken`): the
 * product's own GitHub connection (`studioPushToken`, which also carries an
 * earlier Studio repository over cloud-side). When the product has no
 * repository (or the cloud doesn't know the call yet), the Studio's earlier
 * connection, so Studios not moved yet keep pushing with no customer action.
 * Any other refusal stands. Throws the product's refusal when neither exists.
 */
export async function productPushToken(
  ctx: CloudContext,
  appId: string,
  sources: Partial<PushTokenSources> = {},
): Promise<PushTokenWithRemote> {
  const { studio, legacy } = { studio: cloudPushToken, legacy: legacyPushToken, ...sources };
  try {
    return await studio(ctx, appId);
  } catch (err) {
    const noRepository =
      err instanceof LaunchError && (err.code === GITHUB_NOT_CONNECTED_CODE || isUnsupported(err));
    if (!noRepository) throw err;
    const earlier = await legacy(ctx);
    if (!earlier) throw err;
    ctx.log?.debug?.("[github] pushing with the Studio's earlier GitHub connection");
    return earlier;
  }
}
