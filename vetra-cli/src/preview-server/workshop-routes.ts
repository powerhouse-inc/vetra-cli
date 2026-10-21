/**
 * Workshop routes (owner-only):
 *   POST /workshop/material?name=<file>&type=<mime>   raw body: the file.
 *     201 { id, name, kind, sheets?: { sheet, header, rowCount }[] }
 *     413 { error: "too-large" }  415 { error: "unsupported" }
 *   POST /workshop/snapshots?changeId=&at=   raw JPEG body (<= 400 KB) -> 201; 413 over.
 *   GET  /workshop/snapshots?changeId=       -> 200 { at, file }[] by time.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { saveMaterial, UnsupportedMaterialError } from "../workshop/material.js";
import {
  InvalidSnapshotKeyError,
  listSnapshots,
  saveSnapshot,
  SNAPSHOT_MAX_BYTES,
} from "../workshop/snapshots-store.js";
import { BodyTooLargeError, MATERIAL_MAX_BYTES, readBody } from "./body.js";

export interface WorkshopRouteDeps {
  workdir: string;
  /** The server's owner gate: false (and the refusal written) when refused. */
  requireOwner: (req: IncomingMessage, res: ServerResponse, url: string) => Promise<boolean>;
  log?: { info: (m: string) => void; error: (m: string) => void };
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

  async function snapshots(req: IncomingMessage, res: ServerResponse, url: string, method: string): Promise<void> {
    if (!(await deps.requireOwner(req, res, url))) return;
    const q = new URL(url, "http://localhost").searchParams;
    const changeId = q.get("changeId") ?? "";
    try {
      if (method === "GET") {
        writeJson(res, 200, await listSnapshots(deps.workdir, changeId));
        return;
      }
      let bytes: Buffer;
      try {
        bytes = await readBody(req, SNAPSHOT_MAX_BYTES);
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          writeJson(res, 413, { error: "too-large" }, { Connection: "close" });
          return;
        }
        throw err;
      }
      const file = await saveSnapshot(deps.workdir, changeId, q.get("at") ?? "", bytes);
      writeJson(res, 201, { file });
    } catch (err) {
      if (err instanceof InvalidSnapshotKeyError) {
        if (method === "POST") req.resume();
        writeJson(res, 400, { error: "invalid-key" });
        return;
      }
      throw err;
    }
  }

  return {
    async handle(req, res, url, method) {
      const path = url.split("?")[0];
      if (path === "/workshop/material" && method === "POST") {
        await uploadMaterial(req, res, url);
        return true;
      }
      if (path === "/workshop/snapshots" && (method === "POST" || method === "GET")) {
        await snapshots(req, res, url, method);
        return true;
      }
      return false;
    },
  };
}
