import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  type SandboxConfig,
  appendDomain,
  appendReadPath,
  appendWritePath,
  applySessionOverlay,
  BUILTIN_DEFAULT_CONFIG,
  ensureDefaultConfig,
  findProjectKey,
  getConfigPaths,
  loadEffectiveBase,
  readDefault,
  readProjects,
  resolveProjectAppendKey,
  validateConfig,
  writeDefault,
  writeProjects,
} from "../src/config.ts";

let HOME: string;

beforeEach(() => {
  HOME = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-sandbox-config-")));
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
});

describe("getConfigPaths", () => {
  test("places files under ~/.pi/agent/sandbox/", () => {
    const p = getConfigPaths(HOME);
    expect(p.dir).toBe(join(HOME, ".pi", "agent", "sandbox"));
    expect(p.defaultPath).toBe(join(p.dir, "default.json"));
    expect(p.projectsPath).toBe(join(p.dir, "projects.json"));
  });
});

describe("read*/write* round-trips", () => {
  test("readDefault returns empty when missing", () => {
    expect(readDefault(HOME)).toEqual({});
  });
  test("readProjects returns empty when missing", () => {
    expect(readProjects(HOME)).toEqual({});
  });
  test("writeDefault then readDefault returns same content", () => {
    const cfg: Partial<SandboxConfig> = { enabled: true, network: { allowedDomains: ["github.com"], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] } };
    writeDefault(cfg, HOME);
    expect(readDefault(HOME)).toEqual(cfg);
  });
  test("writeProjects then readProjects round-trip", () => {
    const cfg: Partial<SandboxConfig> = { enabled: true, network: { allowedDomains: [], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] } };
    writeProjects({ "/work/foo": cfg }, HOME);
    expect(readProjects(HOME)).toEqual({ "/work/foo": cfg });
  });
  test("invalid JSON in default.json → returns empty (not throw)", () => {
    const p = getConfigPaths(HOME);
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(p.defaultPath, "{not json");
    expect(readDefault(HOME)).toEqual({});
  });
});

describe("ensureDefaultConfig", () => {
  test("creates default.json with built-ins when missing", () => {
    ensureDefaultConfig(HOME);
    expect(existsSync(getConfigPaths(HOME).defaultPath)).toBe(true);
    const saved = readDefault(HOME);
    expect(saved.enabled).toBe(true);
    // Built-in defaults follow the workspace-only pattern from the
    // @anthropic-ai/sandbox-runtime docs: deny reads under user home dirs,
    // re-allow cwd via ".".
    expect(saved.network?.allowedDomains).toEqual([]);
    expect(saved.filesystem?.denyRead).toEqual(["/Users", "/home"]);
    // `.` re-allows the workspace, `~/.pi` re-allows the extension install
    // tree (apply-seccomp binary must be visible inside bwrap).
    expect(saved.filesystem?.allowRead).toEqual([".", "~/.pi"]);
    expect(saved.filesystem?.allowWrite).toEqual(["."]);
    expect(saved.filesystem?.denyWrite).toEqual([]);
  });
  test("does not overwrite existing default.json", () => {
    const p = getConfigPaths(HOME);
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(p.defaultPath, JSON.stringify({ enabled: false, network: { allowedDomains: [], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: [], denyWrite: [] } }));
    ensureDefaultConfig(HOME);
    expect(readDefault(HOME).enabled).toBe(false);
  });
});

describe("validateConfig", () => {
  test("accepts a minimal valid SandboxRuntimeConfig + enabled", () => {
    const cfg: Partial<SandboxConfig> = {
      enabled: true,
      network: { allowedDomains: ["github.com"], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] },
    };
    const result = validateConfig(cfg);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.enabled).toBe(true);
  });
  test("rejects bare-* in allowedDomains (upstream schema rule)", () => {
    const result = validateConfig({
      network: { allowedDomains: ["*"], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    });
    expect(result.ok).toBe(false);
  });
  test("rejects missing network/filesystem", () => {
    expect(validateConfig({}).ok).toBe(false);
  });
});

describe("findProjectKey / longest-prefix lookup", () => {
  test("returns null when projects is empty", () => {
    expect(findProjectKey("/work/foo", {})).toBeNull();
  });
  test("longest matching key wins", () => {
    const projects = {
      "/work": {},
      "/work/foo": {},
    };
    expect(findProjectKey("/work/foo/sub", projects)).toBe("/work/foo");
  });
  test("respects directory boundary", () => {
    expect(findProjectKey("/etcd", { "/etc": {} })).toBeNull();
  });
});

describe("loadEffectiveBase", () => {
  test("falls back to default when no project key matches", () => {
    const def: Partial<SandboxConfig> = { enabled: true, network: { allowedDomains: ["github.com"], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] } };
    writeDefault(def, HOME);
    // Use HOME as the cwd we look up — must canonicalize the same way
    const result = loadEffectiveBase(HOME, HOME);
    expect(result.projectKey).toBeNull();
    expect(result.base).toEqual(def);
  });
  test("project entry overrides default (no merging)", () => {
    const def: Partial<SandboxConfig> = { enabled: true, network: { allowedDomains: ["github.com"], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] } };
    const proj: Partial<SandboxConfig> = { enabled: true, network: { allowedDomains: ["custom.com"], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] } };
    writeDefault(def, HOME);
    const projectDir = join(HOME, "workspace");
    mkdirSync(projectDir);
    const canonical = realpathSync.native(projectDir);
    writeProjects({ [canonical]: proj }, HOME);
    const result = loadEffectiveBase(projectDir, HOME);
    expect(result.projectKey).toBe(canonical);
    expect(result.base.network?.allowedDomains).toEqual(["custom.com"]);
  });
});

describe("applySessionOverlay", () => {
  const base: Partial<SandboxConfig> = {
    network: { allowedDomains: ["a.com"], deniedDomains: [] },
    filesystem: { denyRead: [], allowRead: ["/tmp"], allowWrite: ["."], denyWrite: [] },
  };
  test("appends session domains", () => {
    const out = applySessionOverlay(base, { domains: ["b.com"] });
    expect(out.network?.allowedDomains).toEqual(["a.com", "b.com"]);
  });
  test("appends session read paths", () => {
    const out = applySessionOverlay(base, { readPaths: ["/var"] });
    expect(out.filesystem?.allowRead).toEqual(["/tmp", "/var"]);
  });
  test("appends session write paths", () => {
    const out = applySessionOverlay(base, { writePaths: ["/srv"] });
    expect(out.filesystem?.allowWrite).toEqual([".", "/srv"]);
  });
  test("does not mutate input", () => {
    applySessionOverlay(base, { domains: ["b.com"], readPaths: ["/var"], writePaths: ["/srv"] });
    expect(base.network?.allowedDomains).toEqual(["a.com"]);
    expect(base.filesystem?.allowRead).toEqual(["/tmp"]);
  });
});

describe("append* mutators", () => {
  test("appendDomain dedupes", () => {
    const cfg: Partial<SandboxConfig> = { network: { allowedDomains: ["a.com"], deniedDomains: [] } };
    expect(appendDomain(cfg, "a.com")).toBe(cfg); // same reference, no change
    expect(appendDomain(cfg, "b.com").network?.allowedDomains).toEqual(["a.com", "b.com"]);
  });
  test("appendDomain creates network field if missing", () => {
    expect(appendDomain({}, "x.com").network?.allowedDomains).toEqual(["x.com"]);
  });
  test("appendReadPath creates filesystem if missing", () => {
    expect(appendReadPath({}, "/x").filesystem?.allowRead).toEqual(["/x"]);
  });
  test("appendWritePath creates filesystem if missing", () => {
    expect(appendWritePath({}, "/x").filesystem?.allowWrite).toEqual(["/x"]);
  });
});

describe("resolveProjectAppendKey", () => {
  test("uses existing parent key when present", () => {
    const projects = { "/work/foo": {} };
    // We pass an absolute path so canonicalization is a no-op on most systems
    const probe = "/work/foo/sub";
    // canonicalizePath may resolve "/work/foo/sub" through realpath since none of these exist —
    // the function will fall back to absolute, which is exactly /work/foo/sub.
    expect(resolveProjectAppendKey(probe, projects)).toBe("/work/foo");
  });
  test("returns canonical cwd when no match", () => {
    expect(resolveProjectAppendKey("/no/match/here", {})).toBe("/no/match/here");
  });
});

describe("disk format stability", () => {
  test("default.json is pretty-printed JSON with trailing newline", () => {
    writeDefault({ enabled: true } as Partial<SandboxConfig>, HOME);
    const text = readFileSync(getConfigPaths(HOME).defaultPath, "utf-8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.includes("  ")).toBe(true);
  });
});

describe("BUILTIN_DEFAULT_CONFIG", () => {
  test("validates against SandboxRuntimeConfigSchema", () => {
    const result = validateConfig(BUILTIN_DEFAULT_CONFIG);
    expect(result.ok).toBe(true);
  });
});
