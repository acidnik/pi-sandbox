/**
 * Output parsing helpers — used to detect OS-sandbox write denials in bash
 * subprocess output so we can prompt the user to grant access and retry.
 */

/**
 * Extract the first blocked write path from a bash "Operation not permitted"
 * error string. Handles common shell prefixes:
 *   "/bin/bash: line 3: /etc/foo: Operation not permitted"
 *   "bash: /etc/foo: Operation not permitted"
 *   "sh: line 1: /etc/foo: Operation not permitted"
 *
 * Returns null if no match.
 */
export function extractBlockedWritePath(output: string): string | null {
  const match = output.match(
    /(?:\/bin\/bash|bash|sh): (?:line \d+: )?(\/[^\s:]+): Operation not permitted/,
  );
  return match ? (match[1] ?? null) : null;
}
