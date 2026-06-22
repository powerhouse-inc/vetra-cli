/**
 * JWT handler for the embedded switchboard's HTTP attachment routes
 * (`/attachments/*`). ph-clint owns the attachment service but has no identity;
 * it calls this (via the `attachmentJwtHandler` CLI option) so reservation /
 * upload requests carry the agent's owner-delegated Renown bearer token.
 * Without it, an auth-enabled switchboard rejects them (401), failing every
 * agent invocation that touches attachments.
 *
 * Returns undefined when the agent isn't authorized yet (getBearerToken → null),
 * so the request goes out unauthenticated rather than throwing.
 */
import { getBearerToken } from "./renown.js";

export function attachmentJwtHandler(
  workdir: string,
  renownUrl: string,
  mintToken: (
    workdir: string,
    renownUrl: string,
  ) => Promise<string | null> = getBearerToken,
): (url: string) => Promise<string | undefined> {
  return async () => (await mintToken(workdir, renownUrl)) ?? undefined;
}
