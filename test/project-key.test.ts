import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  type ProjectsConfig,
  type SandboxConfig,
  appendDomain,
  findProjectKey,
  readProjects,
  resolveProjectAppendKey,
  writeProjects,
} from "../src/config.ts";

let HOME: string;

beforeEach(() => {
  HOME = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-sandbox-projkey-")));
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
});

const stubCfg: Partial<SandboxConfig> = {
  enabled: true,
  network: { allowedDomains: ["github.com"], deniedDomains: [] },
  filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] },
};

describe('"Allow for this project" — parent vs new behaviour', () => {
  test("exact match: append to that entry, no new key", () => {
    const projectDir = join(HOME, "work");
    mkdirSync(projectDir);
    const key = realpathSync.native(projectDir);
    writeProjects({ [key]: stubCfg }, HOME);

    const projects = readProjects(HOME);
    expect(findProjectKey(projectDir, projects)).toBe(key);
    expect(resolveProjectAppendKey(projectDir, projects)).toBe(key);

    // Simulating an "Allow for this project" → appendDomain to the existing key
    projects[key] = appendDomain(projects[key]!, "new.com");
    writeProjects(projects, HOME);

    const after = readProjects(HOME);
    expect(Object.keys(after).length).toBe(1);
    expect(after[key]?.network?.allowedDomains).toContain("new.com");
  });

  test('parent match + "Allow for this project" (append) keeps single key', () => {
    const parent = join(HOME, "parent");
    mkdirSync(parent);
    const sub = join(parent, "sub");
    mkdirSync(sub);
    const parentKey = realpathSync.native(parent);
    writeProjects({ [parentKey]: stubCfg }, HOME);

    const projects = readProjects(HOME);
    expect(findProjectKey(sub, projects)).toBe(parentKey);
    expect(resolveProjectAppendKey(sub, projects)).toBe(parentKey);

    projects[parentKey] = appendDomain(projects[parentKey]!, "added.com");
    writeProjects(projects, HOME);

    const after = readProjects(HOME);
    expect(Object.keys(after)).toEqual([parentKey]);
    expect(after[parentKey]?.network?.allowedDomains).toEqual(["github.com", "added.com"]);
  });

  test("no match: resolveProjectAppendKey returns canonicalized cwd", () => {
    const isolated = join(HOME, "isolated");
    mkdirSync(isolated);
    const canonical = realpathSync.native(isolated);
    expect(resolveProjectAppendKey(isolated, {})).toBe(canonical);
  });

  test("symlinked cwd resolves to canonical key before lookup", () => {
    const real = join(HOME, "real");
    mkdirSync(real);
    const canonical = realpathSync.native(real);
    const link = join(HOME, "link");
    symlinkSync(real, link);

    const projects: ProjectsConfig = { [canonical]: stubCfg };
    // Look up via the symlink — should resolve to canonical key
    expect(findProjectKey(link, projects)).toBe(canonical);
    expect(resolveProjectAppendKey(link, projects)).toBe(canonical);
  });
});

describe("longest-prefix priority", () => {
  test("when both parent and grandparent exist, longest wins", () => {
    const gp = join(HOME, "g");
    const p = join(gp, "p");
    const sub = join(p, "sub");
    mkdirSync(sub, { recursive: true });
    const gpKey = realpathSync.native(gp);
    const pKey = realpathSync.native(p);
    writeProjects({ [gpKey]: stubCfg, [pKey]: stubCfg }, HOME);

    expect(findProjectKey(sub, readProjects(HOME))).toBe(pKey);
  });
});
