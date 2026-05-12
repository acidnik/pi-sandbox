/**
 * Process-level teardown handlers.
 *
 * `session_shutdown` covers graceful pi exits, but does not fire on hard
 * kills (SIGINT, SIGTERM, SIGHUP) or some crash paths. We register process
 * handlers so the OS-level sandbox state is always torn down before the
 * process exits.
 *
 * Extracted to its own module so it can be unit-tested with a fake
 * process emitter.
 */

export type Signal = "SIGINT" | "SIGTERM" | "SIGHUP";
export const SIGNALS: readonly Signal[] = ["SIGINT", "SIGTERM", "SIGHUP"];

export interface TeardownHandle {
  /** Detach all registered handlers. Idempotent. */
  detach(): void;
  /** Whether the teardown function has already run. */
  isDone(): boolean;
}

export interface TeardownDeps {
  /** Process-like emitter with on/off and exit/kill. */
  process: {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
    pid?: number;
    exit?(code?: number): void;
    kill?(pid: number, signal: string | number): true;
  };
  /** The async teardown action (e.g. SandboxManager.reset). Must be idempotent. */
  teardown(): Promise<void> | void;
}

/**
 * Register process-level teardown handlers. The returned handle exposes
 * detach() (for disable/disposal) and isDone().
 *
 * On SIGINT/SIGTERM/SIGHUP: detach our handlers, run teardown, then re-raise
 * the signal so pi's own handlers still see it.
 * On beforeExit: run teardown best-effort.
 */
export function attachTeardown(deps: TeardownDeps): TeardownHandle {
  let done = false;
  const signalListeners = new Map<Signal, (...args: unknown[]) => void>();
  let beforeExitListener: ((...args: unknown[]) => void) | null = null;

  async function runOnce(): Promise<void> {
    if (done) return;
    done = true;
    try {
      await deps.teardown();
    } catch {
      // best-effort
    }
  }

  for (const sig of SIGNALS) {
    const handler = (): void => {
      // Detach first so re-raising doesn't loop back into us.
      detach();
      void runOnce().finally(() => {
        if (deps.process.pid !== undefined && deps.process.kill) {
          try {
            deps.process.kill(deps.process.pid, sig);
          } catch {
            deps.process.exit?.(130);
          }
        } else {
          deps.process.exit?.(130);
        }
      });
    };
    signalListeners.set(sig, handler);
    deps.process.on(sig, handler);
  }

  beforeExitListener = (): void => {
    void runOnce();
  };
  deps.process.on("beforeExit", beforeExitListener);

  function detach(): void {
    for (const [sig, handler] of signalListeners) {
      deps.process.off(sig, handler);
    }
    signalListeners.clear();
    if (beforeExitListener) {
      deps.process.off("beforeExit", beforeExitListener);
      beforeExitListener = null;
    }
  }

  return {
    detach,
    isDone: () => done,
  };
}
