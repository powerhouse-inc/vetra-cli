import type { StudioProductDocument } from "document-models/studio-product/v1";
import {
  initProduct,
  isStudioProductDocument,
  setExternalChanges,
  setGithub,
  utils,
} from "document-models/studio-product/v1";
import { describe, expect, it } from "vitest";
import { BRING_IN_REQUEST, isBringIn } from "../src/utils.js";
import { apply, at, errorAt, lastError } from "./helpers.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function product(): StudioProductDocument {
  return apply(
    utils.createDocument(),
    initProduct({
      name: "Dog walks",
      idea: "plan dog walks",
      createdAt: at(0),
    }),
  );
}

describe("GithubOperations", () => {
  it("a connected repo mirrors, fails a push, flags and clears changes made on GitHub, then disconnects", () => {
    let doc = apply(
      product(),
      setGithub({ status: "CONNECTED", repoFullName: " acme/dog-walks " }),
    );
    expect(isStudioProductDocument(doc)).toBe(true);
    expect(lastError(doc)).toBeNull();
    expect(doc.state.global.github).toEqual({
      status: "CONNECTED",
      repoFullName: "acme/dog-walks",
      lastError: null,
      externalChangesSha: null,
    });

    // A failed push keeps the repository and records the plain reason.
    doc = apply(
      doc,
      setGithub({ status: "PUSH_FAILED", lastError: " GitHub didn't answer " }),
    );
    expect(doc.state.global.github).toEqual({
      status: "PUSH_FAILED",
      repoFullName: "acme/dog-walks",
      lastError: "GitHub didn't answer",
      externalChangesSha: null,
    });

    // Changes pushed on GitHub are recorded while a repository is linked.
    doc = apply(doc, setExternalChanges({ sha: SHA.toUpperCase() }));
    expect(lastError(doc)).toBeNull();
    expect(doc.state.global.github.externalChangesSha).toBe(SHA);

    // The next successful mirror clears the failure, not the changes.
    doc = apply(doc, setGithub({ status: "CONNECTED", repoFullName: null }));
    expect(doc.state.global.github).toEqual({
      status: "CONNECTED",
      repoFullName: "acme/dog-walks",
      lastError: null,
      externalChangesSha: SHA,
    });

    // Brought in: cleared.
    doc = apply(doc, setExternalChanges({ sha: null }));
    expect(doc.state.global.github.externalChangesSha).toBeNull();
    doc = apply(doc, setExternalChanges({ sha: SHA }));

    // Disconnected (revoked or repo deleted): the name stays, nothing waits.
    doc = apply(
      doc,
      setGithub({ status: "DISCONNECTED", lastError: "the app was removed" }),
    );
    expect(doc.state.global.github).toEqual({
      status: "DISCONNECTED",
      repoFullName: "acme/dog-walks",
      lastError: "the app was removed",
      externalChangesSha: null,
    });

    // Reconnected to another repository.
    doc = apply(
      doc,
      setGithub({ status: "CONNECTED", repoFullName: "web3-berlin/dog-walks" }),
      setExternalChanges({ sha: SHA }),
      setGithub({
        status: "DISCONNECTED",
        repoFullName: null,
        lastError: "  ",
      }),
    );
    expect(doc.state.global.github).toEqual({
      status: "DISCONNECTED",
      repoFullName: "web3-berlin/dog-walks",
      lastError: null,
      externalChangesSha: null,
    });

    // NOT_CONNECTED clears the link.
    doc = apply(
      doc,
      setGithub({
        status: "NOT_CONNECTED",
        repoFullName: "x/y",
        lastError: "z",
      }),
    );
    expect(doc.state.global.github).toEqual({
      status: "NOT_CONNECTED",
      repoFullName: null,
      lastError: null,
      externalChangesSha: null,
    });
  });

  it("a different repository forgets the old repository's changes", () => {
    const doc = apply(
      product(),
      setGithub({ status: "CONNECTED", repoFullName: "acme/one" }),
      setExternalChanges({ sha: SHA }),
      setGithub({ status: "CONNECTED", repoFullName: "acme/one" }),
    );
    expect(doc.state.global.github.externalChangesSha).toBe(SHA);
    const moved = apply(
      doc,
      setGithub({ status: "CONNECTED", repoFullName: "acme/two" }),
    );
    expect(moved.state.global.github.externalChangesSha).toBeNull();
    expect(moved.state.global.github.repoFullName).toBe("acme/two");
  });

  it("works on a document from before the github module (normalized)", () => {
    const doc = product();
    // An old document without the field.
    delete (doc.state.global as Partial<typeof doc.state.global>).github;
    const next = apply(
      doc,
      setGithub({ status: "CONNECTED", repoFullName: "a/b" }),
    );
    expect(next.state.global.github.repoFullName).toBe("a/b");
  });

  it("SET_GITHUB errors leave the state as it was", () => {
    const start = product();
    const doc = apply(
      start,
      // 1: no repository known yet
      setGithub({ status: "CONNECTED" }),
      // 2: not owner/name
      setGithub({ status: "CONNECTED", repoFullName: "just-a-name" }),
      // 3: a disconnected link without a repository
      setGithub({ status: "DISCONNECTED", repoFullName: "  " }),
      // 4: a failed push without its reason
      setGithub({ status: "PUSH_FAILED", repoFullName: "acme/x" }),
      // 5: also when the reason is blank
      setGithub({
        status: "PUSH_FAILED",
        repoFullName: "acme/x",
        lastError: " ",
      }),
      // 6: owner/name with extra parts
      setGithub({ status: "CONNECTED", repoFullName: "a/b/c" }),
    );
    expect(errorAt(doc, 1)).toBe(
      "A CONNECTED GitHub link needs the repository's owner/name.",
    );
    expect(errorAt(doc, 2)).toBe(
      'The repository "just-a-name" is not of the form owner/name.',
    );
    expect(errorAt(doc, 3)).toBe(
      "A DISCONNECTED GitHub link needs the repository's owner/name.",
    );
    expect(errorAt(doc, 4)).toBe("A failed push needs its plain reason.");
    expect(errorAt(doc, 5)).toBe("A failed push needs its plain reason.");
    expect(errorAt(doc, 6)).toBe(
      'The repository "a/b/c" is not of the form owner/name.',
    );
    expect(doc.state.global.github).toEqual(start.state.global.github);
  });

  it("SET_EXTERNAL_CHANGES errors leave the state as it was", () => {
    const doc = apply(
      product(),
      // 1: nothing linked
      setExternalChanges({ sha: SHA }),
      setGithub({ status: "CONNECTED", repoFullName: "acme/x" }),
      // 3: not a sha
      setExternalChanges({ sha: "main" }),
      // 4: too short
      setExternalChanges({ sha: "abc12" }),
    );
    expect(errorAt(doc, 1)).toBe(
      "Changes on GitHub can only be recorded while a repository is linked.",
    );
    expect(errorAt(doc, 3)).toBe('"main" is not a commit sha.');
    expect(errorAt(doc, 4)).toBe('"abc12" is not a commit sha.');
    expect(doc.state.global.github.externalChangesSha).toBeNull();

    // Clearing is always allowed, also with nothing linked.
    const cleared = apply(product(), setExternalChanges({ sha: null }));
    expect(lastError(cleared)).toBeNull();
  });
});

describe("bring in", () => {
  it("is a CHANGE with the exact request", () => {
    expect(
      isBringIn({ kind: "CHANGE", request: ` ${BRING_IN_REQUEST} ` }),
    ).toBe(true);
    expect(isBringIn({ kind: "UNDO", request: BRING_IN_REQUEST })).toBe(false);
    expect(isBringIn({ kind: "CHANGE", request: "Add a map" })).toBe(false);
  });
});
