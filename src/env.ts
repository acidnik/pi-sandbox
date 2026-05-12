/**
 * Track environment-variable mutations so they can be reverted on disable.
 *
 * pi-sandbox sets `NODE_USE_ENV_PROXY` so child Node processes pick up the
 * proxy env vars set by SandboxManager. We do the same, but record the
 * mutation so /sandbox-disable can restore the original state.
 */

export interface EnvTracker {
  /** Set an env var, recording the previous value so it can be restored. */
  set(key: string, value: string): void;
  /** Restore all tracked env vars to their original state. */
  restore(): void;
}

export function createEnvTracker(env: Record<string, string | undefined> = process.env): EnvTracker {
  const originals = new Map<string, string | undefined>();
  return {
    set(key, value) {
      if (!originals.has(key)) originals.set(key, env[key]);
      env[key] = value;
    },
    restore() {
      for (const [key, original] of originals) {
        if (original === undefined) {
          delete env[key];
        } else {
          env[key] = original;
        }
      }
      originals.clear();
    },
  };
}
