import {
  createClient,
  type ReactorGraphQLClient,
} from "@powerhousedao/reactor-browser";
import { CLOUD_SWITCHBOARD_URL } from "./config.js";

/** GraphQL endpoint of the cloud switchboard (staging.vetra.io). */
export const cloudGraphqlEndpoint = `${CLOUD_SWITCHBOARD_URL}/graphql`;

type RenownTokenSource = {
  getBearerToken: (opts: { expiresIn: number }) => Promise<string | null>;
};

/**
 * Mint a Renown bearer token. IMPORTANT: do NOT pass `aud`. The switchboard's
 * verifyAuthBearerToken has no expected audience configured, and did-jwt then
 * rejects any token carrying an `aud` claim. Connect's built-in sync handler
 * sends `aud`, which is why local-mirror sync 401s; this client mirrors
 * vetra.to and omits it.
 */
export async function getAuthToken(renown: unknown): Promise<string | null> {
  const source = renown as RenownTokenSource | null | undefined;
  if (!source || typeof source.getBearerToken !== "function") return null;
  try {
    return await source.getBearerToken({ expiresIn: 600 });
  } catch {
    return null;
  }
}

export type AuthTokenProvider = () => Promise<string | null>;

let authTokenProvider: AuthTokenProvider | null = null;

/** Register the bearer-token provider used for every reactor client request. */
export function setAuthTokenProvider(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider;
}

async function resolveToken(): Promise<string | null> {
  if (authTokenProvider) {
    try {
      return await authTokenProvider();
    } catch {
      /* fall through to the global Renown instance */
    }
  }
  if (typeof window !== "undefined") {
    const renown = (
      window as unknown as { ph?: { renown?: RenownTokenSource } }
    ).ph?.renown;
    if (renown) return getAuthToken(renown);
  }
  return null;
}

async function withAuth<T>(
  action: (headers?: Record<string, string>) => Promise<T>,
): Promise<T> {
  const token = await resolveToken();
  if (!token) return action();
  return action({ authorization: `Bearer ${token}` });
}

/** Reactor GraphQL client for signed action push/pull against the cloud. */
export const client: ReactorGraphQLClient = createClient(
  cloudGraphqlEndpoint,
  withAuth,
);
