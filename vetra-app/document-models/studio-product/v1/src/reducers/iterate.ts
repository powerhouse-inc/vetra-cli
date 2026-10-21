import type { StudioProductIterateOperations } from "document-models/studio-product/v1";
import {
  ChangeNotOpenError,
  DuplicateReviewIdError,
  InvalidOriginError,
  InvalidPublicSourceError,
  InvalidReviewCountError,
  InvalidReviewTextError,
  InvalidVariantTransitionError,
  OriginNotFoundError,
  UnknownVersionError,
  VariantChangeNotFoundError,
  VariantNotFoundError,
  VariantNotReadyError,
  VariantsExistError,
} from "../../gen/iterate/error.js";
import type {
  Change,
  ChangeStatus,
  StudioProductState,
  Suggestion,
  Variant,
  VariantLabel,
  VariantStatus,
} from "../../gen/schema/types.js";
import { normalizeProduct } from "../normalize.js";
import { SUGGESTION_TEXT_MAX } from "../suggestions.js";

/** A review pass offers at most 3 findings (spec §5.7). */
const REVIEW_MAX = 3;
/** Variants start while the change is still being worked on. */
const VARIANT_OPEN: ChangeStatus[] = ["BUILDING", "READY"];
/** A building variant ends either ready or failed. */
const VARIANT_DONE: VariantStatus[] = ["READY", "FAILED"];

function findChange(state: StudioProductState, changeId: string): Change {
  normalizeProduct(state);
  const change = state.changes.find((c) => c.id === changeId);
  if (!change) {
    throw new VariantChangeNotFoundError(`No change "${changeId}" exists.`);
  }
  return change;
}

function findVariant(change: Change, label: VariantLabel): Variant {
  const variant = change.variants.find((v) => v.label === label);
  if (!variant) {
    throw new VariantNotFoundError(
      `Change "${change.id}" has no variant ${label}.`,
    );
  }
  return variant;
}

function building(label: VariantLabel, branch: string): Variant {
  return {
    label,
    branch,
    status: "BUILDING",
    chatSessionId: null,
    summary: null,
  };
}

export const studioProductIterateOperations: StudioProductIterateOperations = {
  setReviewSuggestionsOperation(state, action) {
    normalizeProduct(state);
    const { afterVersion, items } = action.input;
    if (!state.versions.some((v) => v.number === afterVersion)) {
      throw new UnknownVersionError(`No version ${afterVersion} exists.`);
    }
    if (items.length > REVIEW_MAX) {
      throw new InvalidReviewCountError(
        `Give 0 to ${REVIEW_MAX} review findings, not ${items.length}.`,
      );
    }
    // Open findings for the same version are replaced; ideas and used or
    // dismissed findings stay.
    const kept = state.suggestions.filter(
      (s) =>
        !(
          s.kind === "REVIEW" &&
          s.status === "OPEN" &&
          s.afterVersion === afterVersion
        ),
    );
    const ids = new Set(kept.map((s) => s.id));
    const added: Suggestion[] = [];
    for (const item of items) {
      const text = item.text.trim();
      if (!text || text.length > SUGGESTION_TEXT_MAX) {
        throw new InvalidReviewTextError(
          `A review finding is 1 to ${SUGGESTION_TEXT_MAX} characters long.`,
        );
      }
      if (ids.has(item.id)) {
        throw new DuplicateReviewIdError(
          `A suggestion "${item.id}" already exists.`,
        );
      }
      ids.add(item.id);
      added.push({
        id: item.id,
        text,
        afterVersion,
        status: "OPEN",
        kind: "REVIEW",
        screenshot: item.screenshot || null,
      });
    }
    state.suggestions = [...kept, ...added];
  },

  startVariantsOperation(state, action) {
    const change = findChange(state, action.input.changeId);
    if (!VARIANT_OPEN.includes(change.status)) {
      throw new ChangeNotOpenError(
        `Change "${change.id}" is ${change.status}; variants start while it is building or ready.`,
      );
    }
    if (change.variants.some((v) => v.status !== "DISCARDED")) {
      throw new VariantsExistError(
        `Change "${change.id}" already has variants.`,
      );
    }
    change.variants = [
      building("A", action.input.branchA),
      building("B", action.input.branchB),
    ];
  },

  setVariantStatusOperation(state, action) {
    const { label, status, chatSessionId, summary } = action.input;
    const variant = findVariant(
      findChange(state, action.input.changeId),
      label,
    );
    if (variant.status !== "BUILDING" || !VARIANT_DONE.includes(status)) {
      throw new InvalidVariantTransitionError(
        `Variant ${label} can't go from ${variant.status} to ${status}.`,
      );
    }
    variant.status = status;
    if (chatSessionId) variant.chatSessionId = chatSessionId;
    if (summary) variant.summary = summary;
  },

  keepVariantOperation(state, action) {
    const change = findChange(state, action.input.changeId);
    const kept = findVariant(change, action.input.label);
    if (kept.status !== "READY") {
      throw new VariantNotReadyError(
        `Variant ${kept.label} is ${kept.status}; only a ready one can be kept.`,
      );
    }
    for (const variant of change.variants) {
      variant.status = variant === kept ? "KEPT" : "DISCARDED";
    }
  },

  setOriginOperation(state, action) {
    normalizeProduct(state);
    const input = action.input;
    const packageName = input.packageName.trim();
    const version = input.version.trim();
    if (!packageName || !version) {
      throw new InvalidOriginError(
        "An origin needs a package name and a version.",
      );
    }
    const existing = state.origins.find((o) => o.packageName === packageName);
    const origin = {
      packageName,
      version,
      mode: input.mode,
      license: input.license,
      sourceUrl: input.sourceUrl || null,
      sourceRef: input.sourceRef || null,
      at: input.at,
      missing: input.missing,
      // The last upstream check stays valid across a re-record.
      latestVersion: existing?.latestVersion ?? null,
      checkedAt: existing?.checkedAt ?? null,
    };
    if (existing) Object.assign(existing, origin);
    else state.origins.push(origin);
  },

  setUpstreamVersionOperation(state, action) {
    normalizeProduct(state);
    const { packageName } = action.input;
    const origin = state.origins.find((o) => o.packageName === packageName);
    if (!origin) {
      throw new OriginNotFoundError(`No origin "${packageName}" exists.`);
    }
    origin.latestVersion = action.input.latestVersion;
    origin.checkedAt = action.input.checkedAt;
  },

  setNotesEnabledOperation(state, action) {
    normalizeProduct(state);
    const { enabled, at } = action.input;
    if (!enabled) {
      state.notes = { enabled: false, since: null };
    } else if (!state.notes.enabled) {
      state.notes = { enabled: true, since: at };
    }
  },

  acceptSourceNoticeOperation(state, action) {
    normalizeProduct(state);
    state.sourceNoticeAcceptedAt = action.input.at;
  },

  setPublicSourceOperation(state, action) {
    normalizeProduct(state);
    const { kind, url, version } = action.input;
    if (version < 1) {
      throw new InvalidPublicSourceError(
        `A public source version is 1 or more, not ${version}.`,
      );
    }
    state.publicSource = { kind, url, version };
  },
};
