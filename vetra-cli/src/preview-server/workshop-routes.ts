/**
 * Workshop routes (owner-only):
 *   POST /workshop/material?name=<file>&type=<mime>   raw body: the file.
 *     201 { id, name, kind, sheets?: { sheet, header, rowCount }[] }
 *     413 { error: "too-large" }  415 { error: "unsupported" }
 *   POST /workshop/understand   JSON { materialIds: string[], text: string, language: "de" | "en" } (≤ 64 KB)
 *     200 UnderstandResult
 *     400 { error: "invalid" | "empty" | "too-many" }  404 { error: "unknown-material", id }
 *     402 { error: "budget" }  422 { error: "unreadable", notes }  503 { error: "no-model" }
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadMaterial, saveMaterial, UnsupportedMaterialError, type MaterialInfo } from "../workshop/material.js";
import {
  understand,
  UnderstandBudgetError,
  UnderstandUnreadableError,
  UNDERSTAND_MAX_INPUTS,
  type UnderstandDeps,
} from "../workshop/understand.js";
import { BodyTooLargeError, MATERIAL_MAX_BYTES, readBody } from "./body.js";

export interface WorkshopRouteDeps {
  workdir: string;
  /** The server's owner gate: false (and the refusal written) when refused. */
  requireOwner: (req: IncomingMessage, res: ServerResponse, url: string) => Promise<boolean>;
  /** The understand pass's model access (the Studio's LLM settings); null = no model connected. */
  understandDeps?: () => UnderstandDeps | null;
  log?: { info: (m: string) => void; error: (m: string) => void };
}

/** Largest JSON body of POST /workshop/understand. */
export const UNDERSTAND_BODY_MAX_BYTES = 64 * 1024;

type UnderstandBody = { materialIds: string[]; text: string; language: "de" | "en" };

function parseUnderstandBody(raw: Buffer): UnderstandBody | null {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const { materialIds, text, language } = json as Record<string, unknown>;
  if (!Array.isArray(materialIds) || !materialIds.every((id): id is string => typeof id === "string")) return null;
  if (typeof text !== "string") return null;
  if (language !== "de" && language !== "en") return null;
  return { materialIds: [...new Set(materialIds)], text, language };
}

export interface WorkshopRoutes {
  /** True when the request was a workshop route (and has been answered). */
  handle(req: IncomingMessage, res: ServerResponse, url: string, method: string): Promise<boolean>;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "Content-Disposition",
};

function writeJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS_HEADERS, ...extra });
  res.end(JSON.stringify(body));
}

export function createWorkshopRoutes(deps: WorkshopRouteDeps): WorkshopRoutes {
  async function uploadMaterial(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
    if (!(await deps.requireOwner(req, res, url))) return;
    const q = new URL(url, "http://localhost").searchParams;
    const fileName = q.get("name")?.trim();
    if (!fileName) {
      req.resume();
      writeJson(res, 400, { error: "missing-name" });
      return;
    }
    let bytes: Buffer;
    try {
      bytes = await readBody(req, MATERIAL_MAX_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        // The rest of the upload is not wanted: close once answered.
        writeJson(res, 413, { error: "too-large" }, { Connection: "close" });
        return;
      }
      throw err;
    }
    try {
      const info = await saveMaterial(deps.workdir, {
        fileName,
        mimeType: q.get("type") ?? "",
        bytes,
      });
      deps.log?.info(`[workshop] material ${info.id} (${info.kind}, ${info.bytes} bytes)`);
      writeJson(res, 201, {
        id: info.id,
        name: info.name,
        kind: info.kind,
        ...(info.sheets && {
          sheets: info.sheets.map(({ sheet, header, rowCount }) => ({ sheet, header, rowCount })),
        }),
      });
    } catch (err) {
      if (err instanceof UnsupportedMaterialError) {
        writeJson(res, 415, { error: "unsupported" });
        return;
      }
      throw err;
    }
  }

  async function understandMaterial(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
    if (!(await deps.requireOwner(req, res, url))) return;
    let raw: Buffer;
    try {
      raw = await readBody(req, UNDERSTAND_BODY_MAX_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        writeJson(res, 413, { error: "too-large" }, { Connection: "close" });
        return;
      }
      throw err;
    }
    const body = parseUnderstandBody(raw);
    if (!body) {
      writeJson(res, 400, { error: "invalid" });
      return;
    }
    const inputCount = body.materialIds.length + (body.text.trim() ? 1 : 0);
    if (inputCount === 0) {
      writeJson(res, 400, { error: "empty" });
      return;
    }
    if (inputCount > UNDERSTAND_MAX_INPUTS) {
      writeJson(res, 400, { error: "too-many" });
      return;
    }
    const materials: MaterialInfo[] = [];
    for (const id of body.materialIds) {
      const m = await loadMaterial(deps.workdir, id);
      if (!m) {
        writeJson(res, 404, { error: "unknown-material", id });
        return;
      }
      materials.push(m);
    }
    let model: UnderstandDeps | null;
    try {
      model = deps.understandDeps?.() ?? null;
    } catch (err) {
      deps.log?.error(`[workshop] understand: no model (${err instanceof Error ? err.message : String(err)})`);
      model = null;
    }
    if (!model) {
      writeJson(res, 503, { error: "no-model" });
      return;
    }
    try {
      const result = await understand(model, { materials, text: body.text, language: body.language });
      deps.log?.info(
        `[workshop] understood ${inputCount} input(s) in ${result.ms} ms, $${result.costUsd.toFixed(4)}, ${result.notes.length} unread`,
      );
      writeJson(res, 200, result);
    } catch (err) {
      if (err instanceof UnderstandBudgetError) {
        writeJson(res, 402, { error: "budget" });
        return;
      }
      if (err instanceof UnderstandUnreadableError) {
        writeJson(res, 422, { error: "unreadable", notes: err.notes });
        return;
      }
      throw err;
    }
  }

  return {
    async handle(req, res, url, method) {
      const path = url.split("?")[0];
      if (path === "/workshop/understand" && method === "POST") {
        await understandMaterial(req, res, url);
        return true;
      }
      if (path === "/workshop/material" && method === "POST") {
        await uploadMaterial(req, res, url);
        return true;
      }
      return false;
    },
  };
}
