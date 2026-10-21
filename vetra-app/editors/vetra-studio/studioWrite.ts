/**
 * The Studio write gate (Task 5.SIG, ruling X39).
 *
 * In a cloud Studio every write is signed by the owner's Renown identity. A
 * signed-out page must not write at all: its local reactor would accept the
 * write (an empty user equals an empty user) and it could then never sync to
 * the Studio, whose reactor admits only the owner's delegated keys. So the
 * write is refused here, before dispatch, and the page offers sign-in.
 *
 * A local Studio (no environment id) needs no sign-in and is never refused.
 */
import { resolveSignInRequired } from "./idea/useStudioSignIn.js";

/** Copy shown when a signed-out page tries to write (tests assert it). */
export const SIGN_IN_TO_CHANGE = "Sign in to make changes.";

/** The write was refused because the page is signed out. */
export class SignInRequiredError extends Error {
  constructor() {
    super(SIGN_IN_TO_CHANGE);
    this.name = "SignInRequiredError";
  }
}

export interface StudioWriteGateDeps {
  /** Whether this page needs a Renown sign-in (cloud Studio). */
  signInRequired?: () => Promise<boolean>;
  /** Whether a Renown user is signed in on this page. */
  isSignedIn?: () => boolean;
}

function signedInNow(): boolean {
  const renown = (globalThis as { ph?: { renown?: { user?: { address?: string } } } })
    .ph?.renown;
  return Boolean(renown?.user?.address);
}

/** The pure decision, kept apart from the browser globals for tests. */
export function writeRefused(
  required: boolean,
  signedIn: boolean,
): boolean {
  return required && !signedIn;
}

/**
 * Refuse a write made from a signed-out cloud Studio. Resolves when the write
 * may proceed; throws `SignInRequiredError` before anything is dispatched.
 */
export async function assertStudioWritable(
  deps: StudioWriteGateDeps = {},
): Promise<void> {
  const required = await (deps.signInRequired ?? resolveSignInRequired)();
  const signedIn = (deps.isSignedIn ?? signedInNow)();
  if (writeRefused(required, signedIn)) throw new SignInRequiredError();
}
