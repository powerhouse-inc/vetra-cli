/**
 * The Plan step's brief (spec §5.2): problem, audience and feature list,
 * read from the ideation documents the agent wrote. Pure.
 */
import type { FileNode, Node } from "@powerhousedao/shared/document-drive";
import type { PHDocument } from "document-model";
import type { OpenTarget } from "../ideation/types.js";

export const PLAN_DOCUMENT_TYPES: readonly string[] = [
  "powerhouse/problem-sheet",
  "powerhouse/audience-sheet",
  "powerhouse/brand-sheet",
  "powerhouse/feature",
];

export interface PlanBrief {
  problem: string | null;
  audience: { id: string; name: string; description: string | null }[];
  features: { id: string; name: string; summary: string | null }[];
  /** The plan's documents, each openable with "Edit". */
  documents: OpenTarget[];
}

function text(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Read structurally: documents written by older models may lack fields. */
function globalOf(doc: PHDocument): Record<string, unknown> {
  return record(record(doc.state).global);
}

export function planBrief(
  nodes: readonly Node[],
  documents: readonly PHDocument[],
): PlanBrief {
  const files = nodes.filter(
    (n): n is FileNode =>
      n.kind === "file" &&
      PLAN_DOCUMENT_TYPES.includes((n as FileNode).documentType),
  );
  const byId = new Map(documents.map((d) => [d.header.id, d]));
  const brief: PlanBrief = {
    problem: null,
    audience: [],
    features: [],
    documents: files.map((f) => ({
      id: f.id,
      documentType: f.documentType,
      name: f.name,
    })),
  };
  for (const file of files) {
    const doc = byId.get(file.id);
    if (!doc) continue;
    const g = globalOf(doc);
    if (file.documentType === "powerhouse/problem-sheet") {
      const job = record(g.coreJob);
      brief.problem ??=
        text(g.context) ??
        text(
          [job.verb, job.object, job.clarifier]
            .map(text)
            .filter(Boolean)
            .join(" "),
        );
    } else if (file.documentType === "powerhouse/audience-sheet") {
      const segments = Array.isArray(g.segments) ? g.segments : [];
      for (const segment of segments) {
        const s = record(segment);
        const name = text(s.name);
        if (!name) continue;
        brief.audience.push({
          id: text(s.id) ?? name,
          name,
          description: text(s.description),
        });
      }
    } else if (file.documentType === "powerhouse/feature") {
      brief.features.push({
        id: file.id,
        name: text(g.name) ?? file.name,
        summary: text(g.summary),
      });
    }
  }
  return brief;
}
