import type { StudioProductGithubOperations } from "document-models/studio-product/v1";
import {
  GithubNotConnectedError,
  InvalidRepoNameError,
  InvalidShaError,
  MissingReasonError,
  MissingRepoError,
} from "../../gen/github/error.js";
import type { GithubStatus } from "../../gen/schema/types.js";
import { normalizeProduct } from "../normalize.js";

/** `owner/name`, as GitHub spells a repository. */
const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** A git object id (abbreviated from 7 hex digits up to SHA-256's 64). */
const SHA = /^[0-9a-f]{7,64}$/;
/** States in which a repository is linked and changes there can be seen. */
const LINKED: GithubStatus[] = ["CONNECTED", "PUSH_FAILED"];

function trimmed(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

export const studioProductGithubOperations: StudioProductGithubOperations = {
  setGithubOperation(state, action) {
    normalizeProduct(state);
    const { status } = action.input;
    const github = state.github;
    if (status === "NOT_CONNECTED") {
      github.status = status;
      github.repoFullName = null;
      github.lastError = null;
      github.externalChangesSha = null;
      return;
    }
    const repo = trimmed(action.input.repoFullName) ?? github.repoFullName;
    if (!repo) {
      throw new MissingRepoError(
        `A ${status} GitHub link needs the repository's owner/name.`,
      );
    }
    if (!REPO_NAME.test(repo)) {
      throw new InvalidRepoNameError(
        `The repository "${repo}" is not of the form owner/name.`,
      );
    }
    const reason = trimmed(action.input.lastError);
    if (status === "PUSH_FAILED" && !reason) {
      throw new MissingReasonError("A failed push needs its plain reason.");
    }
    // Changes seen on another repository, or while disconnected, don't apply.
    if (repo !== github.repoFullName || status === "DISCONNECTED") {
      github.externalChangesSha = null;
    }
    github.status = status;
    github.repoFullName = repo;
    github.lastError = status === "CONNECTED" ? null : reason;
  },

  setExternalChangesOperation(state, action) {
    normalizeProduct(state);
    const sha = trimmed(action.input.sha)?.toLowerCase() ?? null;
    if (sha === null) {
      state.github.externalChangesSha = null;
      return;
    }
    if (!LINKED.includes(state.github.status)) {
      throw new GithubNotConnectedError(
        "Changes on GitHub can only be recorded while a repository is linked.",
      );
    }
    if (!SHA.test(sha)) {
      throw new InvalidShaError(`"${action.input.sha}" is not a commit sha.`);
    }
    state.github.externalChangesSha = sha;
  },
};
