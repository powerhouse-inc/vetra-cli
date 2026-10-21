import type {
  StudioTeamAction,
  StudioTeamDocument,
} from "document-models/studio-team/v1";
import { reducer } from "document-models/studio-team/v1";

/** Deterministic timestamps: `at(5)` is 10:05 on 2026-10-20 (UTC). */
export function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 20, 10, minute)).toISOString();
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `at(minute)` plus whole days, as ISO. */
export function plusDays(minute: number, days: number, extraMs = 0): string {
  return new Date(
    Date.parse(at(minute)) + days * DAY_MS + extraMs,
  ).toISOString();
}

export const ALICE = "0xAbCdEf0000000000000000000000000000000001";
export const BOB = "0x00000000000000000000000000000000000000B0";

export function apply(
  doc: StudioTeamDocument,
  ...actions: StudioTeamAction[]
): StudioTeamDocument {
  return actions.reduce((d, a) => reducer(d, a), doc);
}

/** Error of the operation at `index` (null when it succeeded). */
export function errorAt(doc: StudioTeamDocument, index: number): unknown {
  return doc.operations.global[index].error ?? null;
}
