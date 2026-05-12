/**
 * Domain extraction and matching for network policy.
 *
 * Pure module — pattern matching only, no I/O or runtime imports.
 */

/**
 * Extract unique hostnames from any http:// or https:// URL in a command.
 *
 * Stops at the first character that ends the host component (/, ?, #, :, or
 * whitespace). Does *not* strip ports — ports always come after the host
 * separated by ':' which terminates the match anyway.
 */
export function extractDomainsFromCommand(command: string): string[] {
  const urlRegex = /https?:\/\/([^\s/?#:]+)/g;
  const domains = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = urlRegex.exec(command)) !== null) {
    const host = m[1];
    if (host) domains.add(host);
  }
  return [...domains];
}

/**
 * Match a single host against a single pattern.
 * Supports "*.example.com" wildcards. Note: @anthropic-ai/sandbox-runtime
 * rejects bare "*" and overly broad patterns at the schema level, so callers
 * never see one — we still answer correctly if they do.
 */
export function domainMatchesPattern(domain: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return domain === base || domain.endsWith("." + base);
  }
  return domain === pattern;
}

export function domainIsAllowed(domain: string, allowedDomains: readonly string[]): boolean {
  return allowedDomains.some((p) => domainMatchesPattern(domain, p));
}

/** Detect the bare-"*" wildcard. Kept for warning UX even though schema rejects it. */
export function allowsAllDomains(allowedDomains: readonly string[] | undefined): boolean {
  return allowedDomains?.includes("*") ?? false;
}
