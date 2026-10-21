// Header control that downloads a zip of the workspace files. The daemon gates
// /export on the caller's Renown sign-in (the Studio owner), so a signed-out
// caller is pointed at Renown sign-in.
import { useRenownAuth } from "@powerhousedao/reactor-browser";
import { useEffect, useState } from "react";
import {
  fetchExportStatus,
  fetchWorkspaceExport,
} from "./hooks/preview-server-client.js";

export function WorkspaceExportButton() {
  const auth = useRenownAuth();
  const authenticated = auth.status === "authorized";
  const authBusy = auth.status === "loading" || auth.status === "checking";
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-check the export gate whenever the sign-in changes.
  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();
    fetchExportStatus(controller.signal)
      .then((s) => {
        if (!ignore) {
          setAuthorized(s.authorized);
          setStatusFailed(false);
        }
      })
      .catch(() => {
        // Daemon unreachable — fall back to an optimistic button (the download
        // fetch below surfaces the real error) rather than hiding it forever.
        if (!ignore) setStatusFailed(true);
      });
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [authenticated, auth.address]);

  async function download() {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      // Fetch (not a native anchor nav): carries the bearer, and lets us check
      // status so a 401/409 shows a message instead of navigating to the JSON.
      const res = await fetchWorkspaceExport();
      if (!res.ok) {
        setError(
          res.status === 409
            ? "An export is already in progress."
            : "Not authorized to download the workspace.",
        );
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "vetra-workspace.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      setError("Workspace download failed.");
    } finally {
      setDownloading(false);
    }
  }

  // Until the first status resolves (and it hasn't errored), render nothing.
  if (authorized === null && !statusFailed) return null;

  // Signed in but not the owner — nothing they can do, so just explain.
  if (authorized === false && authenticated) {
    return (
      <span
        title="Workspace download is restricted to the Studio owner's wallet."
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground opacity-40"
        aria-label="Workspace download restricted to the Studio owner"
      >
        <DownloadIcon />
      </span>
    );
  }

  // Signed out: pulse to draw attention; the native hover tooltip explains,
  // and a click starts the Renown sign-in that unlocks the download.
  if (authorized === false && !authenticated) {
    return (
      <button
        type="button"
        onClick={() => auth.login()}
        disabled={authBusy}
        title="Sign in with the Studio owner's wallet (Renown) to download the workspace"
        aria-label="Sign in to download the workspace"
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground opacity-70 hover:bg-accent hover:opacity-100 disabled:opacity-40 motion-safe:animate-pulse"
      >
        <DownloadIcon />
      </button>
    );
  }

  // Authorized (or status unknown — optimistic): offer the download.
  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={downloading}
      title={error ?? "Download workspace (zip)"}
      aria-label="Download workspace"
      className={`flex h-5 w-5 items-center justify-center rounded-full hover:bg-accent hover:opacity-100 disabled:opacity-40 ${
        error
          ? "text-destructive opacity-80"
          : "text-muted-foreground opacity-60"
      }`}
    >
      <DownloadIcon />
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className="h-3.5 w-3.5">
      <path
        d="M8 2.5v7M4.75 6.5 8 9.75 11.25 6.5M3 12.5h10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
