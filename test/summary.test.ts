import { describe, expect, test } from "bun:test";

import type { SandboxConfig } from "../src/config.ts";
import { buildSummaryLines } from "../src/summary.ts";

const cfg: Partial<SandboxConfig> = {
  enabled: true,
  network: { allowedDomains: ["github.com", "*.npmjs.org"], deniedDomains: [] },
  filesystem: {
    denyRead: ["/Users", "/home"],
    allowRead: [".", "~/.pi"],
    allowWrite: ["."],
    denyWrite: [],
  },
};

const noSession = { domains: [], readPaths: [], writePaths: [] };

// Neutral path fixtures — buildSummaryLines only embeds them into display
// strings, so any non-empty value works for the assertions.
const baseInput = {
  enabled: true,
  projectKey: null,
  defaultPath: "/tmp/sandbox/default.json",
  projectsPath: "/tmp/sandbox/projects.json",
  base: cfg,
  effective: cfg,
  session: noSession,
};

describe("buildSummaryLines", () => {
  test("reports enabled state + default scope when no project key", () => {
    const lines = buildSummaryLines(baseInput);
    expect(lines[0]).toBe("Sandbox: enabled  scope: default");
  });

  test("reports disabled state in header", () => {
    const lines = buildSummaryLines({ ...baseInput, enabled: false });
    expect(lines[0]).toBe("Sandbox: disabled  scope: default");
  });

  test("project scope shows the matching key", () => {
    const lines = buildSummaryLines({ ...baseInput, projectKey: "/work/foo" });
    expect(lines[0]).toBe("Sandbox: enabled  scope: project (/work/foo)");
  });

  test("config file paths appear in header", () => {
    const lines = buildSummaryLines(baseInput);
    expect(lines.some((l) => l.includes("default.json"))).toBe(true);
    expect(lines.some((l) => l.includes("projects.json"))).toBe(true);
  });

  test("formats allowedDomains with (none) when empty", () => {
    const empty: Partial<SandboxConfig> = {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
    };
    const lines = buildSummaryLines({ ...baseInput, base: empty, effective: empty });
    expect(lines.some((l) => l.includes("allowedDomains: (none)"))).toBe(true);
    expect(lines.some((l) => l.includes("allowRead:  (none)"))).toBe(true);
  });

  test("renders comma-joined lists", () => {
    const lines = buildSummaryLines(baseInput);
    expect(lines.some((l) => l.includes("allowedDomains: github.com, *.npmjs.org"))).toBe(true);
    expect(lines.some((l) => l.includes("allowRead:  ., ~/.pi"))).toBe(true);
    expect(lines.some((l) => l.includes("denyRead:   /Users, /home"))).toBe(true);
  });

  test("includes session-added domains only when present", () => {
    const without = buildSummaryLines(baseInput);
    expect(without.some((l) => l.includes("session-added"))).toBe(false);

    const withSession = buildSummaryLines({
      ...baseInput,
      session: { domains: ["added.com"], readPaths: [], writePaths: [] },
    });
    expect(withSession.some((l) => l.includes("session-added:  added.com"))).toBe(true);
  });

  test("includes session-read and session-write only when present", () => {
    const lines = buildSummaryLines({
      ...baseInput,
      session: { domains: [], readPaths: ["/var/log"], writePaths: ["/srv"] },
    });
    expect(lines.some((l) => l.includes("session-read:"))).toBe(true);
    expect(lines.some((l) => l.includes("session-write:"))).toBe(true);
  });

  test("notes when stored config has enabled: false", () => {
    const lines = buildSummaryLines({
      ...baseInput,
      base: { ...cfg, enabled: false },
    });
    expect(lines.some((l) => l.includes("enabled: false in stored config"))).toBe(true);
  });

  test("does NOT add the disabled-config note when enabled is true", () => {
    const lines = buildSummaryLines(baseInput);
    expect(lines.some((l) => l.includes("enabled: false in stored config"))).toBe(false);
  });
});
