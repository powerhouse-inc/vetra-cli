/**
 * Owner-only routes for iterating on the product from the Studio page
 * (`/iterate/*`). Every route here passes the server's owner gate
 * (`requireOwner`: the Studio-bound Renown token) before anything else, so an
 * `/iterate/…` path answers 401/403 to anyone but the owner, matched or not.
 * Bodies are JSON in and out.
 *
 * Code edits made from these routes go through `applyStudioEdit`
 * (`studioEditContext` builds its context), so each one is an ordinary change.
 *
 *   GET /iterate/healthz   owner: `{ ok: true }`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProductContext } from "../product/product-doc.js";
import {
  StudioEditRefusedError,
  type RunProcess,
  type StudioEditContext,
} from "../product/studio-edit.js";

export interface IterateRouteDeps {
  /** The server's owner gate: false (and the 401/403 written) when refused. */
  requireOwner(req: IncomingMessage, res: ServerResponse, url: string): Promise<boolean>;
  writeJson(res: ServerResponse, status: number, body: unknown): void;
  workdir: string;
  /** The command context the product document and the reactor are reached through. */
  product?: ProductContext & { runProcess?: RunProcess };
  /** The running preview's URL for a reactor project directory. */
  previewUrl?: (base: string) => string | undefined;
  log?: { warn?: (m: string) => void; error?: (m: string) => void };
}

export interface IterateRoutes {
  /** True when the request was answered here; false lets the server go on (404). */
  handle(req: IncomingMessage, res: ServerResponse, url: string, method: string): Promise<boolean>;
}

const PREFIX = "/iterate/";

/** Largest JSON body an iterate route reads. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** The request's JSON body; throws `BodyError` (400/413) when it isn't one. */
export async function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > limit) throw new BodyError(413, "body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyError(400, "body is not JSON");
  }
}

export class BodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BodyError";
  }
}

/**
 * The context `applyStudioEdit` runs with for a request; null when the Studio
 * has no reactor or no way to run the checks.
 */
export function studioEditContext(
  deps: IterateRouteDeps,
  opts: { chatSessionId?: string | null } = {},
): StudioEditContext | null {
  const product = deps.product;
  if (!product?.runProcess) return null;
  return {
    ...product,
    workdir: deps.workdir,
    runProcess: product.runProcess,
    chatSessionId: opts.chatSessionId ?? null,
    previewUrl: deps.previewUrl,
  };
}

/**
 * The JSON answer for an error an iterate route met: a refused edit is 409
 * with its plain message, a bad body its own status; anything else is 500
 * `internal` (logged, never echoed).
 */
export function errorResponse(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof StudioEditRefusedError) return { status: 409, body: { error: err.message } };
  if (err instanceof BodyError) return { status: err.status, body: { error: err.message } };
  return { status: 500, body: { error: "internal" } };
}

export function createIterateRoutes(deps: IterateRouteDeps): IterateRoutes {
  /** The owner-gated routes; true when one answered. Errors become JSON in `handle`. */
  async function route(
    path: string,
    method: string,
    _req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    if (path === "/iterate/healthz" && method === "GET") {
      deps.writeJson(res, 200, { ok: true });
      return true;
    }
    return false;
  }

  return {
    async handle(req, res, url, method) {
      const path = url.split("?")[0];
      if (!path.startsWith(PREFIX)) return false;
      if (!(await deps.requireOwner(req, res, url))) return true;
      try {
        return await route(path, method, req, res);
      } catch (err) {
        const answer = errorResponse(err);
        if (answer.status === 500) {
          deps.log?.error?.(
            `[iterate] ${method} ${path}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (!res.headersSent) deps.writeJson(res, answer.status, answer.body);
        return true;
      }
    },
  };
}
