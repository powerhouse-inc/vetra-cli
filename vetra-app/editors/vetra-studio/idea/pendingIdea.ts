/**
 * The idea a signed-out visitor typed before signing in (spec §5.3): kept in
 * this browser's localStorage across the sign-in round trip, and taken (read
 * and removed) once it is sent. It never leaves the browser except as the
 * first message in the Studio's own drive.
 *
 * Storage can be missing or throw (private mode, blocked site data): every
 * access is wrapped, and the idea then lasts only as long as the page.
 */

export const PENDING_IDEA_STORAGE_KEY = "vetra-studio:pending-idea";

/** A round trip takes minutes; an idea older than this is not sent on its own. */
export const PENDING_IDEA_MAX_AGE_MS = 60 * 60 * 1000;

interface StoredIdea {
  text: string;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): StoredIdea | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredIdea> | null;
    if (
      value &&
      typeof value.text === "string" &&
      value.text.trim() &&
      typeof value.savedAt === "number"
    ) {
      return { text: value.text, savedAt: value.savedAt };
    }
  } catch {
    // Not ours or damaged: treated as no idea.
  }
  return null;
}

function read(now: number): string | null {
  try {
    const stored = parse(storage()?.getItem(PENDING_IDEA_STORAGE_KEY) ?? null);
    if (!stored) return null;
    if (now - stored.savedAt > PENDING_IDEA_MAX_AGE_MS) return null;
    return stored.text;
  } catch {
    return null;
  }
}

/** Keeps `text` for after the sign-in redirect. */
export function savePendingIdea(text: string, now = Date.now()): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    storage()?.setItem(
      PENDING_IDEA_STORAGE_KEY,
      JSON.stringify({ text: trimmed, savedAt: now } satisfies StoredIdea),
    );
  } catch {
    // Blocked storage: the idea stays in the box only.
  }
}

/** The kept idea without removing it (to show it in the box again). */
export function peekPendingIdea(now = Date.now()): string | null {
  return read(now);
}

/** The kept idea, removed from storage so it is sent only once. */
export function takePendingIdea(now = Date.now()): string | null {
  const text = read(now);
  clearPendingIdea();
  return text;
}

export function clearPendingIdea(): void {
  try {
    storage()?.removeItem(PENDING_IDEA_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
