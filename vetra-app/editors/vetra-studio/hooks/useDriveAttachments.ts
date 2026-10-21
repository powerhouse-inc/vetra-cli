/**
 * The attachment service for a drive's conversations (spec §5.4): chat
 * attachments and the screenshot a pointed request carries. Shared by
 * ChatPane and the preview's "Change this" path; the pure factory is
 * exported so a request can upload without a renderer.
 */
import {
  createRemoteAttachmentService,
  type IAttachmentService,
} from "@powerhousedao/reactor-attachments";
import {
  DEFAULT_SWITCHBOARD_URL,
  useDefaultDrivesUrl,
} from "@powerhousedao/reactor-browser";
import type { DocumentDriveDocument } from "@powerhousedao/shared/document-drive";
import { useMemo } from "react";

/** A drive state's `local.remoteUrl`, when it names one. */
function remoteUrlOf(state: object): string | undefined {
  if (!("local" in state) || !state.local || typeof state.local !== "object") {
    return undefined;
  }
  if (!("remoteUrl" in state.local)) return undefined;
  return typeof state.local.remoteUrl === "string"
    ? state.local.remoteUrl
    : undefined;
}

/**
 * The service for `document`'s drive. The transport appends
 * `/attachments/<hash>` to remoteUrl verbatim. `source` is the proxied
 * switchboard drive URL `…/switchboard/d/<id>`; keep everything up to and
 * including `/switchboard` so attachment requests stay under the proxy base
 * (`…/switchboard/attachments/<hash>`, which the proxy maps to switchboard
 * `/attachments/<hash>`). Without a `/switchboard` segment (non-proxied
 * switchboard), fall back to origin.
 */
export function driveAttachments(
  document: { state: object },
  defaultDrivesUrl?: string | null,
): IAttachmentService {
  const driveRemoteUrl = remoteUrlOf(document.state);
  const source = driveRemoteUrl ?? defaultDrivesUrl ?? DEFAULT_SWITCHBOARD_URL;
  const url = new URL(source);
  const sbEnd = url.pathname.indexOf("/switchboard");
  const remoteUrl =
    sbEnd === -1
      ? url.origin
      : url.origin + url.pathname.slice(0, sbEnd + "/switchboard".length);
  return createRemoteAttachmentService({ remoteUrl });
}

/** The attachment service for the drive's conversations. */
export function useDriveAttachments(
  document: DocumentDriveDocument,
): IAttachmentService {
  const defaultDrivesUrl = useDefaultDrivesUrl();
  return useMemo(
    () => driveAttachments(document, defaultDrivesUrl),
    [document, defaultDrivesUrl],
  );
}
