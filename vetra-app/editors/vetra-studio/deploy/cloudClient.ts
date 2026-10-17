import {
  createReactorClient,
  type ReactorGraphQLClient,
} from "@powerhousedao/vetra-cloud-client";
import { resolveStudioCloudSwitchboardUrl } from "../hooks/preview-server-client.js";
import { CLOUD_SWITCHBOARD_URL } from "./config.js";

let endpointPromise: Promise<string> | undefined;

/**
 * GraphQL endpoint of the cloud switchboard: the one the agent was pointed at
 * (studio.config.json), else the shared default (staging). A prod studio must
 * not talk to staging — its prod credentials are rejected there (401).
 */
export function resolveCloudGraphqlEndpoint(): Promise<string> {
  endpointPromise ??= resolveStudioCloudSwitchboardUrl()
    .catch(() => null)
    .then(
      (url) => `${(url ?? CLOUD_SWITCHBOARD_URL).replace(/\/$/, "")}/graphql`,
    );
  return endpointPromise;
}

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

let clientPromise: Promise<ReactorGraphQLClient> | undefined;

function resolveClient(): Promise<ReactorGraphQLClient> {
  clientPromise ??= resolveCloudGraphqlEndpoint().then((endpoint) =>
    createReactorClient(endpoint, resolveToken),
  );
  return clientPromise;
}

/**
 * Reactor GraphQL client for signed action push/pull against the cloud. The
 * endpoint is only known once studio.config.json loads, so every method
 * forwards to the client built for it; the shape (which methods exist) comes
 * from a client on the default endpoint, which never sends a request.
 */
export const client: ReactorGraphQLClient = new Proxy(
  createReactorClient(`${CLOUD_SWITCHBOARD_URL}/graphql`, resolveToken),
  {
    get(shape, prop, receiver) {
      const value: unknown = Reflect.get(shape, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const real = await resolveClient();
        const method = Reflect.get(real, prop) as (...a: unknown[]) => unknown;
        return method.apply(real, args);
      };
    },
  },
);
