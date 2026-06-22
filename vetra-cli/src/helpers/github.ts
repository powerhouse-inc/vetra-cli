type GqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
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
  installationId: string;
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
          connection { environmentId installationId repoFullName repoUrl createdAt }
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
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vetra-cli' },
  });
  if (!res.ok) {
    throw new Error(`Could not resolve bot user ${login}: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { id: number };
  return body.id;
}

/** The Renown bearer the agent authenticates with, from `VETRA_USER_BEARER`. */
export function resolveUserBearer(): Promise<string> {
  const bearer = process.env.VETRA_USER_BEARER;
  if (!bearer) {
    return Promise.reject(new Error('VETRA_USER_BEARER is not set.'));
  }
  return Promise.resolve(bearer);
}

/** POSIX shell single-quote a value so it is safe to embed in a command. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type RepoRemote = {
  token: string;
  repoFullName: string;
  remoteUrl: string;
};

/**
 * Resolve the environment's connected repo and a fresh installation token as a
 * tokenized HTTPS git remote URL, usable for both fetch/pull and push.
 */
export async function resolveRepoRemote(config: {
  environmentId?: string;
  cloudSwitchboardUrl?: string;
  githubAppSlug?: string;
}): Promise<RepoRemote> {
  const environmentId = config.environmentId;
  if (!environmentId) {
    throw new Error('No environment id configured (set VETRA_ENVIRONMENT_ID).');
  }
  const switchboardUrl = config.cloudSwitchboardUrl;
  if (!switchboardUrl) {
    throw new Error('No cloud switchboard URL configured (set VETRA_CLOUD_SWITCHBOARD_URL).');
  }
  const bearer = await resolveUserBearer();
  const status = await fetchConnection(switchboardUrl, environmentId, bearer);
  if (!status.connected || !status.connection) {
    throw new Error(
      'This studio is not connected to GitHub yet — connect a repository from the Vetra dashboard first.',
    );
  }
  const repoFullName = status.connection.repoFullName;
  const { token } = await fetchPushToken(switchboardUrl, environmentId, bearer).catch(
    (error: unknown) => {
      if (error instanceof GithubAuthError && error.code === 'REINSTALL_REQUIRED') {
        throw new Error(
          'The Vetra GitHub app was uninstalled — reconnect GitHub from the Vetra dashboard.',
        );
      }
      throw error;
    },
  );
  const remoteUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
  return { token, repoFullName, remoteUrl };
}
