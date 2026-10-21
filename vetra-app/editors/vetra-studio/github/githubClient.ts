/**
 * The Studio's GitHub calls: the Vetra Deploy GitHub App's install address,
 * the caller's installations (personal account or organisation), and
 * attaching a repository to the Studio's product. All of them already exist
 * in the cloud (Tasks 4.1/4.2); this file only wraps them with the Studio's
 * plain-language results, so the dialog never shows a code or a stack trace.
 */
import { gql } from "../deploy/githubConnect.js";

export type GithubDeployAppInfo = {
  slug: string;
  installUrl: string;
  authorizeUrl: string;
};

export type GithubDeployInstallation = {
  installationId: string;
  accountLogin: string;
  accountType: string;
};

export type AttachStudioRepositoryResult =
  { ok: true } | { ok: false; message: string; code: string | null };

/** What the dialog says when the cloud can't be reached at all. */
export const GITHUB_UNREACHABLE =
  "Couldn't reach GitHub. Check your connection and try again.";

/** The org path's refusals, in words the person can act on. */
const PLAIN_MESSAGES: Partial<Record<string, string>> = {
  ORG_POLICY:
    "Ask an owner of the organisation to allow Vetra, or choose your personal account.",
  INSUFFICIENT_PERMISSION:
    "Install Vetra on that account or choose your personal account.",
  GITHUB_NOT_CONNECTED:
    "Your GitHub connection has expired or was removed. Reconnect GitHub, then try again.",
  GITHUB_UNAVAILABLE: "GitHub isn't responding. Try again in a minute.",
  FORBIDDEN: "Only you can connect GitHub, from your browser.",
  BAD_USER_INPUT: "GitHub didn't accept that. Try again.",
  REPO_EXISTS: "That repository name is taken. Choose another name.",
};

/**
 * The caller's Vetra Deploy App info (`installUrl` opens GitHub's install
 * page). Null when the cloud can't answer.
 */
export async function fetchGithubDeployAppInfo(
  token: string | null,
): Promise<GithubDeployAppInfo | null> {
  const { data } = await gql<{ githubDeployAppInfo: GithubDeployAppInfo }>(
    `query {
      githubDeployAppInfo { slug installUrl authorizeUrl }
    }`,
    {},
    token,
  );
  return data?.githubDeployAppInfo ?? null;
}

/**
 * The installations of the caller's own GitHub connection — one per personal
 * account or organisation. Null when the cloud can't answer; an empty list
 * means GitHub isn't installed yet.
 */
export async function fetchMyGithubDeployInstallations(
  token: string | null,
): Promise<GithubDeployInstallation[] | null> {
  const { data } = await gql<{
    myGithubDeployInstallations: GithubDeployInstallation[];
  }>(
    `query {
      myGithubDeployInstallations {
        installationId
        accountLogin
        accountType
      }
    }`,
    {},
    token,
  );
  const list = data?.myGithubDeployInstallations;
  return Array.isArray(list) ? list : null;
}

/**
 * Create the product's private repository in the chosen installation's
 * account and record it on the App. The Studio's agent and the mirror write
 * the product document; this call only tells the cloud.
 */
export async function attachStudioRepository(
  input: { appId: string; installationId: string; name?: string },
  token: string | null,
): Promise<AttachStudioRepositoryResult> {
  const { data, errorMessage, errorText } = await gql<{
    attachStudioRepository: { id: string };
  }>(
    `mutation ($input: AttachStudioRepositoryInput!) {
      attachStudioRepository(input: $input) { id }
    }`,
    {
      input: {
        appId: input.appId,
        installationId: input.installationId,
        name: input.name?.trim() || null,
      },
    },
    token,
  );
  if (data?.attachStudioRepository) return { ok: true };

  const code = errorMessage;
  // The cloud already names the organisation in these two; use its sentence
  // when it has one, so the next step is exact.
  const cloudWords =
    code === "ORG_POLICY" || code === "INSUFFICIENT_PERMISSION"
      ? errorText?.trim()
      : null;
  const message =
    cloudWords && cloudWords.length > 0
      ? cloudWords
      : ((code ? PLAIN_MESSAGES[code] : undefined) ??
        "Something went wrong while connecting GitHub. Try again.");
  return { ok: false, message, code };
}

/** "personal account" / "organisation" for an installation's account. */
export function accountTypeLabel(accountType: string): string {
  return accountType === "Organization" ? "organisation" : "personal account";
}

/** A repository name from the product's name: "Task board" → "task-board". */
export function defaultRepoName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "my-product"
  );
}
