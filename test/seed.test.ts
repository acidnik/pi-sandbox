import { describe, expect, test } from "bun:test";

import { type ProjectsConfig, type SandboxConfig, seedNewProjectEntry } from "../src/config.ts";

const validDefaults: Partial<SandboxConfig> = {
  enabled: true,
  network: { allowedDomains: ["github.com"], deniedDomains: [] },
  filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] },
};

const validParent: Partial<SandboxConfig> = {
  enabled: true,
  network: { allowedDomains: ["custom.com"], deniedDomains: [] },
  filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] },
};

describe("seedNewProjectEntry", () => {
  test("copies parent entry when sourceKey present and valid", () => {
    const projects: ProjectsConfig = { "/parent": validParent };
    const result = seedNewProjectEntry(projects, validDefaults, "/parent", "/parent/sub");
    expect(result["/parent/sub"]?.network?.allowedDomains).toEqual(["custom.com"]);
    // Parent entry untouched
    expect(result["/parent"]).toBe(projects["/parent"]);
  });

  test("falls back to defaults when sourceKey is null", () => {
    const result = seedNewProjectEntry({}, validDefaults, null, "/new");
    expect(result["/new"]?.network?.allowedDomains).toEqual(["github.com"]);
  });

  test("falls back to defaults when sourceKey is missing in projects", () => {
    const result = seedNewProjectEntry({}, validDefaults, "/nonexistent", "/new");
    expect(result["/new"]?.network?.allowedDomains).toEqual(["github.com"]);
  });

  test("deep-clones — mutating result does not affect source", () => {
    const projects: ProjectsConfig = { "/parent": structuredClone(validParent) };
    const result = seedNewProjectEntry(projects, validDefaults, "/parent", "/new");
    result["/new"]!.network!.allowedDomains!.push("mutated.com");
    expect(projects["/parent"]?.network?.allowedDomains).toEqual(["custom.com"]);
  });

  test("invalid parent entry → fallback to defaults + onInvalid called", () => {
    // Parent entry has invalid bare-* which the schema rejects
    const badParent: Partial<SandboxConfig> = {
      network: { allowedDomains: ["*"], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    };
    const warnings: string[] = [];
    const result = seedNewProjectEntry(
      { "/parent": badParent },
      validDefaults,
      "/parent",
      "/new",
      (msg) => {
        warnings.push(msg);
      },
    );
    expect(result["/new"]?.network?.allowedDomains).toEqual(["github.com"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("/parent");
  });

  test("does not overwrite existing keys other than newKey", () => {
    const projects: ProjectsConfig = { "/a": validParent, "/b": validParent };
    const result = seedNewProjectEntry(projects, validDefaults, "/a", "/c");
    expect(Object.keys(result).sort()).toEqual(["/a", "/b", "/c"]);
  });
});
