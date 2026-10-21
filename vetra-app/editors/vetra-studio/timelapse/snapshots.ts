/** When to take a preview snapshot during a build (pure rules). */
export const SNAPSHOT_INTERVAL_MS = 20_000;
export const SNAPSHOT_MAX = 60;
export const SNAPSHOT_WIDTH = 960;
export const SNAPSHOT_QUALITY = 0.7;

export function shouldSnapshot(input: {
  lastAt: number | null;
  lastHash: string | null;
  now: number;
  hash: string;
  building: boolean;
  count: number;
}): boolean {
  if (!input.building) return false;
  if (input.count >= SNAPSHOT_MAX) return false;
  if (input.lastAt !== null && input.now - input.lastAt < SNAPSHOT_INTERVAL_MS)
    return false;
  return input.hash !== input.lastHash;
}

/** A cheap fingerprint of what the frame shows: its text and top-level shape. */
export function frameHash(body: {
  innerText?: string;
  childElementCount: number;
}): string {
  const text = body.innerText ?? "";
  let h = 5381;
  for (let i = 0; i < text.length; i++)
    h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}:${text.length}:${body.childElementCount}`;
}
