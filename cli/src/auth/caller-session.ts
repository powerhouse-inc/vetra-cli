/**
 * The person's session the `vetra` command line signs with.
 *
 * A command that needs the reactor runs in the running Studio; its actions
 * are signed here, in the caller's process, as the person who typed it
 * (clint asks over the control channel). The session is labelled "vetra":
 * a P-256 key of the active identity, its credential signed by the person's
 * pseudonym (issued here, 30 days) or the Renown login's own session. The
 * credential's record is written where the Studio's switchboard checks it.
 *
 * Loaded on the first signature only: the start path stays free of Renown.
 */
import type { CallerSession, IdentityConfiguration } from "@powerhousedao/clint";

export const openCallerSession: IdentityConfiguration["open"] = async (o) => {
  const { openSession } = await import("@renown/sdk/identity");
  const session = await openSession({
    dataDir: o.dataDir,
    label: o.label,
    place: "home",
    interactive: o.interactive,
    ...(o.target ? { target: o.target } : {}),
  });
  const caller: CallerSession = {
    signer: session.signer,
    signAction: (action, target, previousStateHash) =>
      session.actionSigner.signAction(
        { ...action, context: { ...action.context, prevOpHash: previousStateHash } },
        target,
      ),
    bearer: (b) => session.bearer(b),
  };
  return caller;
};
