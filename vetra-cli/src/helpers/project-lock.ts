import { mkdir } from "node:fs/promises";
import path from "node:path";
import { lock, type LockOptions } from "proper-lockfile";

// mtime is refreshed while held, so a live run never reads as stale; only a
// dead holder's lock expires after `stale`.
const LOCK_OPTIONS: LockOptions = {
  realpath: false,
  stale: 60_000,
  update: 10_000,
  retries: { retries: 180, factor: 1.3, minTimeout: 250, maxTimeout: 1_500 },
};

// Serialize codegen for one reactor project across processes: concurrent
// spec-generate runs rebuild the shared barrels/manifest and drop each other.
export async function withProjectCodegenLock<T>(
  base: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockfilePath = path.join(base, ".ph", "codegen.lock");
  await mkdir(path.dirname(lockfilePath), { recursive: true });

  let release: () => Promise<void>;
  try {
    release = await lock(base, {
      ...LOCK_OPTIONS,
      lockfilePath,
      // Default throws from the refresh timer and would crash the daemon.
      onCompromised: (err) =>
        console.warn(`[spec-generate] codegen lock compromised: ${err.message}`),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not acquire the codegen lock for ${base}; another spec-generate may still be running (${reason}).`,
    );
  }

  try {
    return await fn();
  } finally {
    await release().catch(() => {});
  }
}
