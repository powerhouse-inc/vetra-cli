import type { StudioProductLaunchOperations } from "document-models/studio-product/v1";
import type {
  Change,
  ChangeStatus,
  LaunchLine,
  LaunchLineKind,
  PendingRequest,
  StepStatus,
  StudioProductState,
  Version,
} from "../../gen/schema/types.js";
import {
  ChangeInProgressError,
  ChangeNotFoundError,
  InvalidChangeStatusError,
} from "../../gen/change/error.js";
import {
  ChangeNotReadyError,
  DriveAlreadySetError,
  DuplicatePackageNameError,
  InvalidVersionStatusError,
  NotLiveError,
  RequestPendingError,
  SlugLockedError,
  VersionNotFoundError,
  VersionNumberError,
} from "../../gen/launch/error.js";
import { normalizeProduct } from "../normalize.js";

const LINE_ORDER: LaunchLineKind[] = [
  "SNAPSHOT",
  "PUBLISH",
  "DEPLOY",
  "VERIFY",
  "MIRROR",
];

/** Open changes (Ruling E6): while one exists, Go back is refused. */
const OPEN: ChangeStatus[] = ["BUILDING", "PAUSED", "READY", "LAUNCHING"];

/** Changes that can still be thrown away (a launch in flight cannot). */
const DISCARDABLE: ChangeStatus[] = ["BUILDING", "PAUSED", "READY"];

function findChange(state: StudioProductState, changeId: string): Change {
  const change = state.changes.find((c) => c.id === changeId);
  if (!change) {
    throw new ChangeNotFoundError(`No change "${changeId}" exists.`);
  }
  return change;
}

function findVersion(state: StudioProductState, number: number): Version {
  const version = state.versions.find((v) => v.number === number);
  if (!version) {
    throw new VersionNotFoundError(`No version ${number} exists.`);
  }
  return version;
}

/** Every REQUEST_* is refused while another request waits (F9). */
function request(
  state: StudioProductState,
  next: Omit<PendingRequest, "changeId" | "targetVersion"> &
    Partial<Pick<PendingRequest, "changeId" | "targetVersion">>,
): void {
  if (state.pendingRequest) {
    throw new RequestPendingError(
      `A ${state.pendingRequest.kind} request is still waiting for the agent.`,
    );
  }
  state.pendingRequest = {
    kind: next.kind,
    changeId: next.changeId ?? null,
    targetVersion: next.targetVersion ?? null,
    requestedAt: next.requestedAt,
    requestedBy: next.requestedBy,
  };
}

function requireLive(state: StudioProductState): void {
  if (state.liveVersion === null) {
    throw new NotLiveError("The product has no live version yet.");
  }
}

function waitingLines(): LaunchLine[] {
  return LINE_ORDER.map((kind) => ({ kind, status: "WAITING", detail: null }));
}

/** Mirrors the launch on the change's LIVE step, when that step is planned. */
function markLiveStep(
  change: Change,
  status: StepStatus,
  reason: string | null,
  at: string,
): void {
  const step = change.steps.find((s) => s.kind === "LIVE");
  if (!step) return;
  step.status = status;
  step.reason = reason;
  step.updatedAt = at;
}

/** Makes `version` the only LIVE version; the previous one becomes PREVIOUS. */
function makeLive(state: StudioProductState, version: Version): void {
  for (const v of state.versions) {
    if (v.status === "LIVE" && v !== version) v.status = "PREVIOUS";
  }
  version.status = "LIVE";
  state.liveVersion = version.number;
}

export const studioProductLaunchOperations: StudioProductLaunchOperations = {
  setLiveTargetOperation(state, action) {
    normalizeProduct(state);
    const { slug } = action.input;
    // F12: free to overwrite until the first launch, then the slug is fixed.
    const locked = state.liveVersion !== null && state.slug !== null;
    if (locked && state.slug !== slug) {
      throw new SlugLockedError(
        `The live address is fixed at "${state.slug}" since the first launch.`,
      );
    }
    state.appId = action.input.appId;
    state.productionEnvironmentId = action.input.productionEnvironmentId;
    state.slug = slug;
    state.liveUrl = action.input.liveUrl;
  },

  setProductDriveOperation(state, action) {
    normalizeProduct(state);
    const { driveId } = action.input;
    if (state.productDriveId !== null && state.productDriveId !== driveId) {
      throw new DriveAlreadySetError(
        `The product drive is already "${state.productDriveId}".`,
      );
    }
    state.productDriveId = driveId;
    if (action.input.liveUrl) state.liveUrl = action.input.liveUrl;
  },

  requestLaunchOperation(state, action) {
    normalizeProduct(state);
    const { changeId, requestedAt, requestedBy } = action.input;
    const change = findChange(state, changeId);
    if (change.status !== "READY") {
      throw new ChangeNotReadyError(
        `Change "${changeId}" is ${change.status}; only a READY change can go live.`,
      );
    }
    request(state, { kind: "LAUNCH", changeId, requestedAt, requestedBy });
  },

  requestRollbackOperation(state, action) {
    normalizeProduct(state);
    const { versionNumber, requestedAt, requestedBy } = action.input;
    const open = state.changes.find((c) => OPEN.includes(c.status));
    if (open) {
      throw new ChangeInProgressError(
        `Change "${open.id}" is ${open.status}; finish or discard it first.`,
      );
    }
    const version = findVersion(state, versionNumber);
    if (version.status !== "PREVIOUS") {
      throw new InvalidVersionStatusError(
        `Version ${versionNumber} is ${version.status}; only a previous live version can be made live again.`,
      );
    }
    request(state, {
      kind: "ROLLBACK",
      targetVersion: versionNumber,
      requestedAt,
      requestedBy,
    });
  },

  requestDiscardOperation(state, action) {
    normalizeProduct(state);
    const { changeId, requestedAt, requestedBy } = action.input;
    const change = findChange(state, changeId);
    if (!DISCARDABLE.includes(change.status)) {
      throw new InvalidChangeStatusError(
        `Change "${changeId}" is ${change.status} and can't be discarded.`,
      );
    }
    request(state, { kind: "DISCARD", changeId, requestedAt, requestedBy });
  },

  requestRestartOperation(state, action) {
    normalizeProduct(state);
    requireLive(state);
    request(state, { kind: "RESTART", ...action.input });
  },

  requestMirrorOperation(state, action) {
    normalizeProduct(state);
    requireLive(state);
    request(state, { kind: "MIRROR", ...action.input });
  },

  clearRequestOperation(state) {
    normalizeProduct(state);
    state.pendingRequest = null;
  },

  startLaunchOperation(state, action) {
    normalizeProduct(state);
    const { number, changeId, at } = action.input;
    const change = findChange(state, changeId);
    if (change.status !== "READY") {
      throw new ChangeNotReadyError(
        `Change "${changeId}" is ${change.status}; only a READY change can be launched.`,
      );
    }
    // F23: the next number, or a retry of a FAILED version under its number.
    const next = state.versions.reduce((m, v) => Math.max(m, v.number), 0) + 1;
    const existing = state.versions.find((v) => v.number === number);
    if (number !== next && existing?.status !== "FAILED") {
      throw new VersionNumberError(
        `Version ${number} can't be launched; the next version is ${next}.`,
      );
    }
    const title = change.title ?? change.request;
    if (existing) {
      existing.status = "LAUNCHING";
      existing.changeId = changeId;
      existing.title = title;
      existing.lines = waitingLines();
      existing.failure = null;
    } else {
      state.versions.push({
        number,
        title,
        summary: null,
        changeId,
        gitTag: `v${number}`,
        sha: "",
        packages: [],
        deploymentId: null,
        launchedAt: null,
        launchedBy: "",
        trigger: "",
        status: "LAUNCHING",
        lines: waitingLines(),
        changedFiles: [],
        failure: null,
        rollbackBlockedReason: null,
      });
    }
    change.status = "LAUNCHING";
    markLiveStep(change, "WORKING", null, at);
  },

  setLaunchLineOperation(state, action) {
    normalizeProduct(state);
    const { number, kind, status, detail } = action.input;
    const version = findVersion(state, number);
    const line = version.lines.find((l) => l.kind === kind);
    if (line) {
      line.status = status;
      line.detail = detail ?? line.detail;
    } else {
      version.lines.push({ kind, status, detail: detail ?? null });
      version.lines.sort(
        (a, b) => LINE_ORDER.indexOf(a.kind) - LINE_ORDER.indexOf(b.kind),
      );
    }
  },

  completeLaunchOperation(state, action) {
    normalizeProduct(state);
    const input = action.input;
    const version = findVersion(state, input.number);
    // FAILED is accepted for reconcile: the cloud may finish a launch that
    // was recorded as failed (F22 / Task 2.10).
    if (version.status !== "LAUNCHING" && version.status !== "FAILED") {
      throw new InvalidVersionStatusError(
        `Version ${input.number} is ${version.status}; only a launching version can complete.`,
      );
    }
    const names = new Set<string>();
    for (const p of input.packages) {
      if (names.has(p.name)) {
        throw new DuplicatePackageNameError(
          `Package "${p.name}" is listed more than once.`,
        );
      }
      names.add(p.name);
    }
    // The change behind the version, unless it has moved on since a failed
    // launch (then only the version is reconciled).
    const change = state.changes.find(
      (c) =>
        c.id === version.changeId &&
        (c.status === "LAUNCHING" || c.status === "READY"),
    );
    version.gitTag = input.gitTag;
    version.sha = input.sha;
    version.packages = input.packages.map(({ name, version: v }) => ({
      name,
      version: v,
    }));
    version.deploymentId = input.deploymentId;
    version.title = input.title;
    version.summary = input.summary ?? null;
    version.changedFiles = [...input.changedFiles];
    version.launchedBy = input.launchedBy;
    version.trigger = input.trigger;
    version.launchedAt = input.at;
    version.failure = null;
    makeLive(state, version);
    if (change) {
      change.status = "LAUNCHED";
      change.metrics.liveAt = input.at;
      markLiveStep(change, "DONE", null, input.at);
    }
  },

  failLaunchOperation(state, action) {
    normalizeProduct(state);
    const { number, reason, at } = action.input;
    const version = findVersion(state, number);
    if (version.status !== "LAUNCHING") {
      throw new InvalidVersionStatusError(
        `Version ${number} is ${version.status}; only a launching version can fail.`,
      );
    }
    version.status = "FAILED";
    version.failure = reason;
    const change = state.changes.find((c) => c.id === version.changeId);
    if (change?.status === "LAUNCHING") {
      change.status = "READY";
      markLiveStep(change, "STOPPED", reason, at);
    }
  },

  setLiveVersionOperation(state, action) {
    normalizeProduct(state);
    const { number } = action.input;
    const version = findVersion(state, number);
    if (version.status !== "LIVE" && version.status !== "PREVIOUS") {
      throw new InvalidVersionStatusError(
        `Version ${number} is ${version.status}; only a version that was live can be made live again.`,
      );
    }
    makeLive(state, version);
  },

  setHealthOperation(state, action) {
    normalizeProduct(state);
    state.health = action.input.health;
  },

  setLaunchPermissionOperation(state, action) {
    normalizeProduct(state);
    state.launchPermission = action.input.state;
  },
};
