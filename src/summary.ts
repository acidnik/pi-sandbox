/**
 * Pure builder for the `/sandbox` summary lines.
 *
 * Used in two places:
 *   - The scope picker rendered at the top of /sandbox (the merged
 *     /sandbox + /sandbox-configure command) shows these lines above the
 *     scope options so the user can see effective config before editing.
 *
 * Extracted from index.ts so it's straightforward to unit-test.
 */

import type { SandboxConfig } from "./config.ts";

export interface SummaryInput {
  enabled: boolean;
  /** Project key that matched the cwd, or null if falling back to default. */
  projectKey: string | null;
  defaultPath: string;
  projectsPath: string;
  /** The stored config (without session overlay) — used to surface `enabled: false`. */
  base: Partial<SandboxConfig>;
  /** Effective config (after session overlay) — what the user actually sees enforced. */
  effective: Partial<SandboxConfig>;
  /** In-memory session allowances. */
  session: {
    domains: readonly string[];
    readPaths: readonly string[];
    writePaths: readonly string[];
  };
}

function joinOrNone(list: readonly string[] | undefined): string {
  if (!list || list.length === 0) return "(none)";
  return list.join(", ");
}

export function buildSummaryLines(input: SummaryInput): string[] {
  const { enabled, projectKey, defaultPath, projectsPath, base, effective, session } = input;
  const scope = projectKey ? `project (${projectKey})` : "default";

  const lines: string[] = [
    `Sandbox: ${enabled ? "enabled" : "disabled"}  scope: ${scope}`,
    `  default.json:   ${defaultPath}`,
    `  projects.json:  ${projectsPath}`,
    "",
    "Network:",
    `  allowedDomains: ${joinOrNone(effective.network?.allowedDomains)}`,
    `  deniedDomains:  ${joinOrNone(effective.network?.deniedDomains)}`,
  ];
  if (session.domains.length > 0) {
    lines.push(`  session-added:  ${session.domains.join(", ")}`);
  }

  lines.push(
    "",
    "Filesystem:",
    `  allowRead:  ${joinOrNone(effective.filesystem?.allowRead)}`,
    `  denyRead:   ${joinOrNone(effective.filesystem?.denyRead)}`,
    `  allowWrite: ${joinOrNone(effective.filesystem?.allowWrite)}`,
    `  denyWrite:  ${joinOrNone(effective.filesystem?.denyWrite)}`,
  );
  if (session.readPaths.length > 0) {
    lines.push(`  session-read:   ${session.readPaths.join(", ")}`);
  }
  if (session.writePaths.length > 0) {
    lines.push(`  session-write:  ${session.writePaths.join(", ")}`);
  }

  if (base.enabled === false) {
    lines.push("", "Note: enabled: false in stored config (set true via /sandbox).");
  }

  return lines;
}
