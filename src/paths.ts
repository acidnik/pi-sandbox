/**
 * Path expansion, canonicalization, and pattern matching.
 *
 * Pure module — no extension/runtime imports — so it can be unit-tested in
 * isolation against a tmpdir HOME.
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";

/** Expand a leading "~" to the user's home dir, then resolve to absolute. */
export function expandPath(filePath: string, home: string = homedir()): string {
  const expanded = filePath.replace(/^~(?=$|\/)/, home);
  return resolve(expanded);
}

/**
 * Resolve symlinks. For paths that don't yet exist (e.g. a write target),
 * resolve symlinks in the nearest existing parent and append the missing tail.
 */
export function canonicalizePath(filePath: string, home: string = homedir()): string {
  const abs = expandPath(filePath, home);
  try {
    return realpathSync.native(abs);
  } catch {
    const tail: string[] = [];
    let probe = abs;
    while (!existsSync(probe)) {
      const parent = dirname(probe);
      if (parent === probe) return abs;
      tail.unshift(basename(probe));
      probe = parent;
    }
    try {
      return resolve(realpathSync.native(probe), ...tail);
    } catch {
      return abs;
    }
  }
}

/**
 * Match a path against a list of patterns.
 *
 * - Patterns containing "*" are converted to a regex (escape everything else,
 *   convert "*" to ".*"). Compared against the canonicalized absolute path.
 * - Plain patterns use prefix matching with a directory boundary, so "."
 *   matches the entire cwd subtree but "/etc" does NOT match "/etcd".
 */
export function matchesPattern(
  filePath: string,
  patterns: string[],
  home: string = homedir(),
): boolean {
  const abs = canonicalizePath(filePath, home);
  return patterns.some((p) => {
    const absP = p.includes("*") ? expandPath(p, home) : canonicalizePath(p, home);
    if (p.includes("*")) {
      const escaped = absP.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`).test(abs);
    }
    const sep = absP.endsWith("/") ? "" : "/";
    return abs === absP || abs.startsWith(absP + sep);
  });
}

/**
 * Whether the given path should trigger a write-permission prompt.
 *
 * Secure default: empty allowWrite means deny-all (prompt every path).
 */
export function shouldPromptForWrite(
  path: string,
  allowWrite: string[],
  home: string = homedir(),
): boolean {
  return allowWrite.length === 0 || !matchesPattern(path, allowWrite, home);
}

/**
 * Find the longest absolute path key in `keys` that is a prefix of `cwd`.
 * Returns null if none match. Used for project-config longest-prefix lookup.
 *
 * Both `cwd` and the keys must already be canonicalized by the caller; this
 * function only compares strings (with directory-boundary semantics).
 */
export function longestPrefixMatch(cwd: string, keys: string[]): string | null {
  let best: string | null = null;
  for (const k of keys) {
    if (cwd === k || cwd.startsWith(k.endsWith("/") ? k : k + "/")) {
      if (best === null || k.length > best.length) best = k;
    }
  }
  return best;
}
