/**
 * Running-reactor accessor for the `spec-*` write commands.
 *
 * The commands write the filesystem `specs/` unconditionally (codegen's source
 * of truth) and, when a reactor is already running, ALSO push the change into
 * the embedded `vetra` drive so Vetra Studio reflects it directly — without
 * waiting on the `spec-fs-sync` watcher round-trip.
 *
 * `context.folders` is the non-booting "reactor running" signal: the daemon's
 * startup sequence wires it only when a personal drive exists, and one-shot CLI
 * never does. Calling `ctx.reactor()` blindly would lazily boot a full reactor
 * just to write a spec — so we gate on `folders` first and only then resolve the
 * already-cached reactor. The configured `vetra` drive has role 'personal',
 * so `personalDriveId` is set; fall back to `driveId` for safety.
 */
import type { ReactorContext } from "@powerhousedao/ph-clint";

export interface EmbeddedDrive {
  reactor: Pick<ReactorContext, "client">;
  driveId: string;
}

/**
 * Structural view of the command context this accessor reads. Typed loosely
 * (client as `unknown`) so it accepts a `CommandContext<Config, R>` for any
 * registry `R` without tripping `ReactorContext` generic variance — the caller
 * passes its concrete client straight through to `applyFsChangesToReactor`.
 */
interface RunningReactorCtx {
  folders?: unknown;
  reactor?: () => Promise<
    | { client: unknown; personalDriveId?: string; driveId?: string }
    | undefined
  >;
}

export async function getEmbeddedDrive(
  ctx: RunningReactorCtx,
): Promise<EmbeddedDrive | undefined> {
  if (!ctx.folders) return undefined; // one-shot → no boot, FS only
  const reactor = await ctx.reactor?.(); // cached in the daemon, no boot
  const driveId = reactor?.personalDriveId ?? reactor?.driveId;
  if (!reactor || !driveId) return undefined;
  return { reactor: reactor as Pick<ReactorContext, "client">, driveId };
}
