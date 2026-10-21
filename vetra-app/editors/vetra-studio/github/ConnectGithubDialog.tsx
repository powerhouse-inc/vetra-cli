/**
 * Connect GitHub once (spec §5.6, default Q1): open GitHub's install page in
 * a popup, watch `myGithubDeployInstallations` until the account or
 * organisation appears, then create the product's private repository in the
 * chosen account (`attachStudioRepository`). The page never waits forever:
 * two minutes at most, a visible waiting state, and Cancel/Try again.
 */
import { useRenown } from "@powerhousedao/reactor-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthToken } from "../deploy/cloudClient.js";
import {
  accountTypeLabel,
  attachStudioRepository,
  defaultRepoName,
  fetchGithubDeployAppInfo,
  fetchMyGithubDeployInstallations,
  GITHUB_UNREACHABLE,
  type GithubDeployAppInfo,
  type GithubDeployInstallation,
} from "./githubClient.js";

/** How often the dialog checks for a finished install/authorization. */
export const POLL_INTERVAL_MS = 2000;
/** After this long the dialog stops waiting and offers Try again. */
export const POLL_LIMIT_MS = 120_000;

export const GITHUB_PROMPT_TEXT =
  "Keep a copy of your code in your own GitHub account. Every launch becomes a commit you can see.";
export const WAITING_TEXT = "Waiting for GitHub…";
export const WAITING_HELP =
  "Finish the steps in the GitHub window. This updates by itself.";
export const WAITING_TIMEOUT_TEXT = "GitHub didn't answer. Try again.";
export const CONNECTED_TEXT = "GitHub is connected.";

type Waiting = "idle" | "waiting" | "timed-out";

const PRIMARY_BUTTON =
  "rounded-lg bg-vetra-primary px-3 py-1.5 text-sm font-medium text-vetra-primary-fg hover:bg-vetra-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const QUIET_BUTTON =
  "rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent";

export function ConnectGithubDialog({
  appId,
  productName,
  onClose,
}: {
  /** The Studio product's App (`product.appId`); the repository goes on it. */
  appId: string | null;
  /** Defaults the repository name (`task-board`). */
  productName: string;
  onClose: () => void;
}) {
  const renown = useRenown();
  const [appInfo, setAppInfo] = useState<GithubDeployAppInfo | null>(null);
  const [installations, setInstallations] = useState<
    GithubDeployInstallation[] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting>("idle");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [repoName, setRepoName] = useState(() => defaultRepoName(productName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const token = useCallback(() => getAuthToken(renown), [renown]);
  // The poll reads the list it started with without restarting on each tick.
  const installationsRef = useRef<GithubDeployInstallation[] | null>(null);
  installationsRef.current = installations;
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const bearer = await token();
    const [info, list] = await Promise.all([
      fetchGithubDeployAppInfo(bearer),
      fetchMyGithubDeployInstallations(bearer),
    ]);
    setLoading(false);
    setAppInfo(info);
    if (!info || list === null) {
      setLoadError(GITHUB_UNREACHABLE);
      return;
    }
    setInstallations(list);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the dialog (Settings' own Escape handler ignores nested
  // dialogs, so it never closes both).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Watch for the install/authorization the popup completes. A new
  // installation id ends the wait; two minutes without one times out.
  useEffect(() => {
    if (waiting !== "waiting") return;
    const known = new Set(
      (installationsRef.current ?? []).map((i) => i.installationId),
    );
    const deadline = Date.now() + POLL_LIMIT_MS;
    let stopped = false;
    const tick = async () => {
      const list = await fetchMyGithubDeployInstallations(await token());
      if (stopped) return;
      if (list) {
        setInstallations(list);
        if (list.some((i) => !known.has(i.installationId))) {
          setWaiting("idle");
          return;
        }
      }
      if (Date.now() >= deadline) setWaiting("timed-out");
    };
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waiting, token]);

  const startInstall = useCallback(() => {
    setError(null);
    if (!appInfo?.installUrl) {
      setLoadError(GITHUB_UNREACHABLE);
      return;
    }
    window.open(appInfo.installUrl, "_blank", "noopener,noreferrer");
    setWaiting("waiting");
  }, [appInfo]);

  const selected =
    installations?.find((i) => i.installationId === selectedId) ?? null;

  async function connect() {
    if (!appId) {
      setError("Your product is still loading. Try again in a moment.");
      return;
    }
    if (!selected) return;
    setBusy(true);
    setError(null);
    const result = await attachStudioRepository(
      {
        appId,
        installationId: selected.installationId,
        name: repoName.trim(),
      },
      await token(),
    );
    setBusy(false);
    if (result.ok) setDone(true);
    else setError(result.message);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Connect GitHub"
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <header className="flex items-center border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold text-foreground">
            Connect GitHub
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            Close
          </button>
        </header>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
          {done ? (
            <>
              <p className="font-medium text-foreground">{CONNECTED_TEXT}</p>
              <p className="text-muted-foreground">
                Your code will be saved on GitHub from the next launch.
              </p>
              <button
                type="button"
                onClick={onClose}
                className={PRIMARY_BUTTON}
              >
                Done
              </button>
            </>
          ) : loadError ? (
            <>
              <p role="alert" className="text-destructive">
                {loadError}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void load()}
                  className={PRIMARY_BUTTON}
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={QUIET_BUTTON}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : waiting === "waiting" ? (
            <div aria-busy="true" className="flex flex-col gap-3">
              <p className="font-medium text-foreground">{WAITING_TEXT}</p>
              <p className="text-muted-foreground">{WAITING_HELP}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startInstall}
                  className={QUIET_BUTTON}
                >
                  Open GitHub again
                </button>
                <button
                  type="button"
                  onClick={() => setWaiting("idle")}
                  className={QUIET_BUTTON}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : waiting === "timed-out" ? (
            <>
              <p role="alert" className="font-medium text-foreground">
                {WAITING_TIMEOUT_TEXT}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startInstall}
                  className={PRIMARY_BUTTON}
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => setWaiting("idle")}
                  className={QUIET_BUTTON}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : loading && installations === null ? (
            <p aria-busy="true" className="text-muted-foreground">
              Checking GitHub…
            </p>
          ) : !selected ? (
            <>
              <p className="text-foreground">{GITHUB_PROMPT_TEXT}</p>
              {installations && installations.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <h3 className="font-medium text-foreground">
                    Where should your code go?
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {installations.map((installation) => (
                      <li key={installation.installationId}>
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setSelectedId(installation.installationId);
                            setRepoName(defaultRepoName(productName));
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left hover:border-vetra-primary"
                        >
                          <span className="font-medium text-foreground">
                            {installation.accountLogin}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {accountTypeLabel(installation.accountType)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Your code goes in a new private repository there.
                  </p>
                  <button
                    type="button"
                    onClick={() => setWaiting("waiting")}
                    className="self-start text-xs font-medium text-vetra-primary hover:underline"
                  >
                    Connect another account
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-muted-foreground">
                    Choose the account or organisation on GitHub. You decide
                    which repositories Vetra can see.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={startInstall}
                      className={PRIMARY_BUTTON}
                    >
                      Connect GitHub
                    </button>
                    <button
                      type="button"
                      onClick={() => void load()}
                      className={QUIET_BUTTON}
                    >
                      Check again
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void connect();
              }}
            >
              <p className="text-muted-foreground">
                {selected.accountLogin} —{" "}
                {accountTypeLabel(selected.accountType)}
              </p>
              <label
                htmlFor="studio-github-repo-name"
                className="font-medium text-foreground"
              >
                Repository name
              </label>
              <input
                id="studio-github-repo-name"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                disabled={busy}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-vetra-primary"
              />
              <p className="text-xs text-muted-foreground">
                A new private repository; your code is saved there from the next
                launch.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy || !repoName.trim()}
                  className={PRIMARY_BUTTON}
                >
                  {busy ? "Connecting GitHub…" : "Connect GitHub"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setSelectedId(null);
                  }}
                  className={QUIET_BUTTON}
                >
                  Choose another account
                </button>
              </div>
            </form>
          )}
          {error && !done ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          {!done && !loadError ? (
            <button
              type="button"
              onClick={onClose}
              className="self-start text-xs text-muted-foreground hover:underline"
            >
              Not now
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
