/**
 * `useDocumentsInSelectedDrive` with a self-heal for the node/content sync
 * race. When a file node syncs into the drive before the document's content
 * strand, the document cache's fetch for that id rejects and the rejected
 * promise sticks (the cache refetches only on Updated events — a Created
 * arriving after the failed fetch is ignored). The batch silently drops the
 * doc, so a document the agent just created stays invisible to auto-follow
 * until its next edit — or forever, if it's never edited again.
 *
 * Heal: while some file-node ids are missing from the resolved batch, force
 * a refetch per tick (bounded per id) and bump local state once it settles
 * so the batch recomputes with the recovered document.
 */
import {
  useDocumentCache,
  useDocumentsInSelectedDrive,
  useFileNodesInSelectedDrive,
} from "@powerhousedao/reactor-browser";
import type { PHDocument } from "document-model";
import { useEffect, useReducer, useRef } from "react";

const RETRY_DELAY_MS = 500;
const MAX_ATTEMPTS_PER_DOC = 10;

/** File-node ids with no matching resolved document (pure, unit-testable). */
export function missingDocumentIds(
  fileNodeIds: readonly string[],
  documents: readonly { header: { id: string } }[],
): string[] {
  if (fileNodeIds.length === 0) return [];
  const resolved = new Set(documents.map((d) => d.header.id));
  return fileNodeIds.filter((id) => !resolved.has(id));
}

/** Undefined while the drive hasn't loaded — callers use that as the
 * hydration signal (e.g. ChatPane's `driveLoaded`). */
export function useDriveDocuments(): PHDocument[] | undefined {
  const documents = useDocumentsInSelectedDrive();
  const fileNodes = useFileNodesInSelectedDrive();
  const cache = useDocumentCache();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const attemptsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!cache || !documents || !fileNodes?.length) return;
    const missing = missingDocumentIds(
      fileNodes.map((n) => n.id),
      documents,
    ).filter((id) => (attemptsRef.current.get(id) ?? 0) < MAX_ATTEMPTS_PER_DOC);
    if (missing.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      for (const id of missing) {
        attemptsRef.current.set(id, (attemptsRef.current.get(id) ?? 0) + 1);
        cache.get(id, true).then(
          () => {
            attemptsRef.current.delete(id);
            if (!cancelled) bump();
          },
          () => {
            // Still unavailable — the bump recomputes the batch, which
            // re-runs this effect and schedules the next attempt.
            if (!cancelled) bump();
          },
        );
      }
    }, RETRY_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documents, fileNodes, cache]);

  return documents;
}
