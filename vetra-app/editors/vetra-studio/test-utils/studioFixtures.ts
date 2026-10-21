/** Product, conversation and drive fixtures for Studio shell tests. */
import type { Node } from "@powerhousedao/shared/document-drive";
import type { PHDocument } from "document-model";
import {
  actions,
  reducer,
  utils,
  type StudioProductAction,
  type StudioProductDocument,
  type Version,
} from "document-models/studio-product";
import type { StartProductDrive } from "../idea/startProduct.js";

export const PRODUCT_ID = "product-1";
export const SESSION_ID = "session-1";

/** `at(5)` is 10:05 on 2026-10-20 (UTC). */
export function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 20, 10, minute)).toISOString();
}

export function file(id: string, documentType: string, name = id): Node {
  return { id, name, kind: "file", documentType, parentFolder: null };
}

export function drive(nodes: Node[], id = "drive-1"): StartProductDrive {
  return { header: { id }, state: { global: { nodes } } };
}

/** A product document (id PRODUCT_ID) after `ops`, through the real reducer. */
export function productDoc(
  ...ops: StudioProductAction[]
): StudioProductDocument {
  const base = utils.createDocument();
  const doc = ops.reduce((d, op) => reducer(d, op), base);
  return { ...doc, header: { ...doc.header, id: PRODUCT_ID } };
}

/** Init + first build (change c1, conversation SESSION_ID) planned with all steps. */
export function buildingOps(): StudioProductAction[] {
  return [
    actions.initProduct({
      name: "Task board",
      idea: "a task board for my team",
      createdAt: at(0),
    }),
    actions.startChange({
      id: "c1",
      kind: "FIRST_BUILD",
      request: "a task board for my team",
      chatSessionId: SESSION_ID,
      startedAt: at(1),
    }),
    actions.planSteps({
      changeId: "c1",
      steps: [
        { kind: "PLAN", total: 9 },
        { kind: "DATA", total: 3 },
        { kind: "EDITORS", total: 3 },
        { kind: "TESTS" },
        { kind: "LIVE" },
      ],
    }),
  ];
}

/** A conversation document with `userMessages` user messages. */
export function chatDoc(id: string, userMessages: number): PHDocument {
  const messages = Array.from({ length: userMessages }, (_, i) => ({
    id: `m${i}`,
    role: "USER",
  }));
  return {
    header: { id, documentType: "powerhouse/chat-session" },
    state: { global: { messages } },
  } as unknown as PHDocument;
}

/** One launched version, the shape the agent writes on COMPLETE_LAUNCH. */
export function version(
  number: number,
  launchedAt: string,
  overrides: Partial<Version> = {},
): Version {
  return {
    number,
    title: `Version ${number}`,
    summary: null,
    changeId: "c1",
    gitTag: `v${number}`,
    sha: `sha-${number}`,
    packages: [],
    deploymentId: null,
    launchedAt,
    launchedBy: "Vetra",
    trigger: "AUTO",
    status: "LIVE",
    lines: [],
    changedFiles: [],
    failure: null,
    rollbackBlockedReason: null,
    ...overrides,
  };
}

/** The product with Version `number` live (its change launched) — state 2. */
export function withLiveVersion(
  doc: StudioProductDocument,
  {
    number = 1,
    changeId = "c1",
    liveUrl = "https://task-board.vetra.io",
    launchedAt = at(25),
  }: {
    number?: number;
    changeId?: string;
    liveUrl?: string;
    launchedAt?: string;
  } = {},
): StudioProductDocument {
  const global = doc.state.global;
  global.liveVersion = number;
  global.liveSince = launchedAt;
  global.liveUrl = liveUrl;
  global.versions = [version(number, launchedAt, { changeId })];
  const change = global.changes.find((c) => c.id === changeId);
  if (change) {
    change.status = "LAUNCHED";
    for (const step of change.steps) step.status = "DONE";
  }
  return doc;
}

/** A launch that failed after Version `live` (or the first one): the change
 *  is READY again (F10) and the version carries the plain reason (F39). */
export function withFailedLaunch(
  doc: StudioProductDocument,
  {
    number = 2,
    changeId = "c1",
    reason = "the new version didn't start",
  }: { number?: number; changeId?: string; reason?: string } = {},
): StudioProductDocument {
  const global = doc.state.global;
  global.versions = [
    ...global.versions,
    version(number, at(40), {
      changeId,
      status: "FAILED",
      failure: reason,
      launchedAt: null,
    }),
  ];
  const change = global.changes.find((c) => c.id === changeId);
  if (change) {
    change.status = "READY";
    for (const step of change.steps) {
      if (step.kind !== "LIVE") step.status = "DONE";
    }
  }
  return doc;
}
