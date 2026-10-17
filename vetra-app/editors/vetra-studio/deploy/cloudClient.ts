import {
  createReactorClient,
  type ReactorGraphQLClient,
} from "@powerhousedao/vetra-cloud-client";
import { resolveStudioCloudSwitchboardUrl } from "../hooks/preview-server-client.js";

let endpointPromise: Promise<string> | undefined;

/** Thrown when this studio has no cloud switchboard in studio.config.json. */
export const CLOUD_NOT_CONFIGURED =
  "This studio has no Vetra Cloud switchboard configured, so it can't deploy. Restart the studio, or contact support if it persists.";

/**
 * GraphQL endpoint of the cloud switchboard the agent was pointed at
 * (studio.config.json). No default: guessing staging sent prod studios'
 * credentials to staging (401).
 */
export function resolveCloudGraphqlEndpoint(): Promise<string> {
  endpointPromise ??= resolveStudioCloudSwitchboardUrl()
    .catch(() => null)
    .then((url) => {
      if (!url) throw new Error(CLOUD_NOT_CONFIGURED);
      return `${url.replace(/\/$/, "")}/graphql`;
    });
  // A missing config is retried on the next call (studio.config.json may land later).
  endpointPromise.catch(() => {
    endpointPromise = undefined;
  });
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
  clientPromise.catch(() => {
    clientPromise = undefined;
  });
  return clientPromise;
}

/**
 * Reactor GraphQL client for signed action push/pull against the cloud. The
 * endpoint is only known once studio.config.json loads, so every method
 * forwards to the client built for it.
 */
export const client: ReactorGraphQLClient = new Proxy(
  // Shape only (which methods exist); never sends a request.
  createReactorClient("https://unconfigured.invalid/graphql", resolveToken),
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
