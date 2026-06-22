import {
  createClient,
  type ReactorGraphQLClient,
} from "@powerhousedao/reactor-browser";
import type { TokenProvider } from "./types.js";

/** The reactor GraphQL client type, re-exported so consumers can annotate their
 * client/controller adapters with a portable name. */
export type { ReactorGraphQLClient };

/** Reactor GraphQL client that authorizes each request with a fresh bearer
 * token from `tokenProvider`. Used for signed action push/pull against the
 * cloud switchboard. */
export function createReactorClient(
  endpoint: string,
  tokenProvider: TokenProvider,
): ReactorGraphQLClient {
  const withAuth = async <T>(
    action: (headers?: Record<string, string>) => Promise<T>,
  ): Promise<T> => {
    const token = await tokenProvider();
    return token ? action({ authorization: `Bearer ${token}` }) : action();
  };
  return createClient(endpoint, withAuth);
}
