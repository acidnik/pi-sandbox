/**
 * Status-line rendering.
 *
 * Two variants:
 *   - enabled:  `🔒 Sandbox: N domains, M write paths` (accent colour)
 *   - disabled: `Sandbox: disabled` with `disabled` in red
 *
 * The split-string `renderDisabledParts` exists so the caller can theme the
 * "disabled" word red without depending on a TUI theme inside this pure module.
 */

import type { SandboxConfig } from "./config.ts";
import { allowsAllDomains } from "./domains.ts";

export function renderStatus(config: Partial<SandboxConfig>): string {
  const domains = config.network?.allowedDomains;
  const networkLabel = allowsAllDomains(domains) ? "all domains" : `${domains?.length ?? 0} domains`;
  const writeCount = config.filesystem?.allowWrite?.length ?? 0;
  return `🔒 Sandbox: ${networkLabel}, ${writeCount} write paths`;
}

export interface DisabledParts {
  prefix: string; // "Sandbox: "
  state: string;  // "disabled"
}

export function renderDisabledParts(): DisabledParts {
  return { prefix: "Sandbox: ", state: "disabled" };
}
