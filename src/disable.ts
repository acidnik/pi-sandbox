/**
 * Disable logic, extracted for testing.
 *
 * The pi-sandbox extension has a few small leaks when disabling:
 *   - It does not await `SandboxManager.reset()` from the command handler.
 *   - It does not clear in-memory session allowances, so the next
 *     /sandbox-enable in the same process inherits stale state.
 *   - It does not restore env vars (NODE_USE_ENV_PROXY) it mutated.
 *   - The post-bash "Operation not permitted" scanner is only gated by
 *     `sandboxEnabled` *and* `sandboxInitialized`; if either is wrong, an
 *     unsandboxed bash output containing that substring can still trigger a
 *     write-permission prompt. We use the same flag set here.
 *
 * `performDisable` runs every cleanup step idempotently and surfaces any
 * failures via the result rather than throwing.
 */

import type { EnvTracker } from "./env.ts";
import type { TeardownHandle } from "./teardown.ts";

export interface DisableTarget {
  /** Async teardown of the sandbox runtime (SandboxManager.reset). */
  resetSandbox: () => Promise<void>;
  /** Session-only allowance lists, drained in place. */
  session: {
    domains: string[];
    readPaths: string[];
    writePaths: string[];
  };
  /** Flags toggled to false. */
  flags: {
    enabled: { value: boolean };
    initialized: { value: boolean };
  };
  /** Env tracker to restore. */
  env: EnvTracker;
  /** Process-level teardown handle to detach. */
  teardown: TeardownHandle;
}

export interface DisableResult {
  resetError: unknown | null;
}

export async function performDisable(target: DisableTarget): Promise<DisableResult> {
  let resetError: unknown | null = null;

  // 1. Reset the sandbox runtime first so any in-flight init/listeners are
  //    torn down before we start mutating shared state.
  try {
    await target.resetSandbox();
  } catch (e) {
    resetError = e;
  }

  // 2. Clear in-memory session allowances.
  target.session.domains.length = 0;
  target.session.readPaths.length = 0;
  target.session.writePaths.length = 0;

  // 3. Flip flags off. Both must be false so the bash post-execution scanner
  //    (which checks BOTH) is fully bypassed.
  target.flags.enabled.value = false;
  target.flags.initialized.value = false;

  // 4. Restore env vars.
  target.env.restore();

  // 5. Detach process-level handlers so a later re-enable doesn't
  //    double-register and so disabled pi behaves identically to no-extension pi.
  target.teardown.detach();

  return { resetError };
}
