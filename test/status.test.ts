import { describe, expect, test } from "bun:test";

import type { SandboxConfig } from "../src/config.ts";
import { renderDisabledParts, renderStatus } from "../src/status.ts";

describe("renderStatus", () => {
  test("counts allowed domains and write paths", () => {
    const cfg: Partial<SandboxConfig> = {
      network: { allowedDomains: ["a.com", "b.com", "*.c.com"], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [".", "/tmp"], denyWrite: [] },
    };
    expect(renderStatus(cfg)).toBe("🔒 Sandbox: 3 domains, 2 write paths");
  });

  test('"all domains" wording when bare * sneaks in', () => {
    const cfg: Partial<SandboxConfig> = {
      network: { allowedDomains: ["*", "a.com"], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] },
    };
    expect(renderStatus(cfg)).toBe("🔒 Sandbox: all domains, 1 write paths");
  });

  test("handles missing fields gracefully", () => {
    expect(renderStatus({})).toBe("🔒 Sandbox: 0 domains, 0 write paths");
  });
});

describe("renderDisabledParts", () => {
  test("returns prefix + state for caller-side theming", () => {
    expect(renderDisabledParts()).toEqual({ prefix: "Sandbox: ", state: "disabled" });
  });
  test("prefix + state concatenate to the plain string", () => {
    const { prefix, state } = renderDisabledParts();
    expect(`${prefix}${state}`).toBe("Sandbox: disabled");
  });
});
