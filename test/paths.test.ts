import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  canonicalizePath,
  expandPath,
  longestPrefixMatch,
  matchesPattern,
  shouldPromptForWrite,
} from "../src/paths.ts";

let HOME: string;

beforeEach(() => {
  HOME = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-sandbox-paths-")));
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
});

describe("expandPath", () => {
  test("expands leading ~", () => {
    expect(expandPath("~/foo", HOME)).toBe(join(HOME, "foo"));
  });
  test("plain ~ alone expands to home", () => {
    expect(expandPath("~", HOME)).toBe(HOME);
  });
  test("absolute path unchanged", () => {
    expect(expandPath("/etc/passwd", HOME)).toBe("/etc/passwd");
  });
  test("relative path resolved", () => {
    const cwd = process.cwd();
    expect(expandPath("./foo", HOME)).toBe(join(cwd, "foo"));
  });
  test("does not expand ~user (only bare ~)", () => {
    expect(expandPath("~user/foo", HOME)).not.toBe(join(HOME, "user/foo"));
    expect(expandPath("~user/foo", HOME).endsWith("~user/foo")).toBe(true);
  });
});

describe("canonicalizePath", () => {
  test("resolves existing path symlinks", () => {
    const real = join(HOME, "real");
    mkdirSync(real);
    const link = join(HOME, "link");
    symlinkSync(real, link);
    expect(canonicalizePath(link, HOME)).toBe(real);
  });

  test("handles non-existent tail by resolving nearest existing parent", () => {
    const real = join(HOME, "real");
    mkdirSync(real);
    const link = join(HOME, "link");
    symlinkSync(real, link);
    // link/does-not-exist should canonicalize to real/does-not-exist
    expect(canonicalizePath(join(link, "does-not-exist"), HOME)).toBe(join(real, "does-not-exist"));
  });

  test("falls back to absolute for completely missing path tree", () => {
    const p = "/this/path/does/not/exist/probably";
    const out = canonicalizePath(p, HOME);
    // Should at least be an absolute path
    expect(out.startsWith("/")).toBe(true);
  });
});

describe("matchesPattern", () => {
  test("prefix matches respect directory boundary", () => {
    expect(matchesPattern("/etc/passwd", ["/etc"], HOME)).toBe(true);
    expect(matchesPattern("/etcd/data", ["/etc"], HOME)).toBe(false);
  });

  test("exact path match", () => {
    expect(matchesPattern("/etc", ["/etc"], HOME)).toBe(true);
  });

  test("glob with * (cwd-anchored)", () => {
    // Glob patterns are resolved against cwd (no implicit basename match), so we
    // anchor on an absolute pattern to make the test deterministic.
    expect(matchesPattern("/foo/something.pem", ["/foo/*.pem"], HOME)).toBe(true);
    expect(matchesPattern("/foo/something.txt", ["/foo/*.pem"], HOME)).toBe(false);
    // Multi-segment glob
    expect(matchesPattern("/foo/bar/baz.pem", ["/foo/*/*.pem"], HOME)).toBe(true);
  });

  test("home expansion in patterns", () => {
    const target = join(HOME, "config", "x.json");
    mkdirSync(join(HOME, "config"), { recursive: true });
    writeFileSync(target, "{}");
    expect(matchesPattern(target, ["~/config"], HOME)).toBe(true);
  });

  test("empty pattern list is no match", () => {
    expect(matchesPattern("/etc/passwd", [], HOME)).toBe(false);
  });

  test("trailing slash patterns still work", () => {
    expect(matchesPattern("/etc/passwd", ["/etc/"], HOME)).toBe(true);
  });
});

describe("shouldPromptForWrite", () => {
  test("empty allowWrite means prompt for every path", () => {
    expect(shouldPromptForWrite("/anything", [], HOME)).toBe(true);
  });
  test("matching path does not prompt", () => {
    expect(shouldPromptForWrite("/tmp/foo", ["/tmp"], HOME)).toBe(false);
  });
  test("non-matching path prompts", () => {
    expect(shouldPromptForWrite("/etc/foo", ["/tmp"], HOME)).toBe(true);
  });
});

describe("longestPrefixMatch", () => {
  test("returns null when no key matches", () => {
    expect(longestPrefixMatch("/x", ["/a", "/b"])).toBeNull();
  });
  test("picks the longest matching key", () => {
    expect(longestPrefixMatch("/a/b/c/d", ["/a", "/a/b", "/a/b/c"])).toBe("/a/b/c");
  });
  test("exact match wins over shorter prefix", () => {
    expect(longestPrefixMatch("/a/b", ["/a", "/a/b"])).toBe("/a/b");
  });
  test("respects directory boundary", () => {
    expect(longestPrefixMatch("/etcd", ["/etc"])).toBeNull();
    expect(longestPrefixMatch("/etc/foo", ["/etc"])).toBe("/etc");
  });
  test("handles trailing slash in keys", () => {
    expect(longestPrefixMatch("/a/b", ["/a/"])).toBe("/a/");
  });
});
