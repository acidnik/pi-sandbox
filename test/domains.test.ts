import { describe, expect, test } from "bun:test";

import {
  allowsAllDomains,
  domainIsAllowed,
  domainMatchesPattern,
  extractDomainsFromCommand,
} from "../src/domains.ts";

describe("extractDomainsFromCommand", () => {
  test("plain https URL", () => {
    expect(extractDomainsFromCommand("curl https://github.com/foo")).toEqual(["github.com"]);
  });
  test("plain http URL", () => {
    expect(extractDomainsFromCommand("curl http://example.com/")).toEqual(["example.com"]);
  });
  test("multiple unique URLs", () => {
    const out = extractDomainsFromCommand("a https://x.com/p && b https://y.com");
    expect(new Set(out)).toEqual(new Set(["x.com", "y.com"]));
  });
  test("dedupes repeats", () => {
    expect(extractDomainsFromCommand("https://x.com https://x.com/a https://x.com/b")).toEqual(["x.com"]);
  });
  test("no URLs", () => {
    expect(extractDomainsFromCommand("echo hello")).toEqual([]);
  });
  test("ignores bare hostnames without scheme", () => {
    expect(extractDomainsFromCommand("ssh github.com")).toEqual([]);
  });
});

describe("domainMatchesPattern", () => {
  test("exact match", () => {
    expect(domainMatchesPattern("github.com", "github.com")).toBe(true);
    expect(domainMatchesPattern("github.com", "gitlab.com")).toBe(false);
  });
  test("wildcard prefix", () => {
    expect(domainMatchesPattern("api.github.com", "*.github.com")).toBe(true);
    expect(domainMatchesPattern("github.com", "*.github.com")).toBe(true);
    expect(domainMatchesPattern("not-github.com", "*.github.com")).toBe(false);
  });
  test("bare * matches anything", () => {
    expect(domainMatchesPattern("anything.com", "*")).toBe(true);
  });
});

describe("domainIsAllowed", () => {
  test("matches any pattern in list", () => {
    expect(domainIsAllowed("api.github.com", ["github.com", "*.github.com"])).toBe(true);
  });
  test("rejects when no pattern matches", () => {
    expect(domainIsAllowed("evil.com", ["github.com", "*.npmjs.org"])).toBe(false);
  });
  test("empty list rejects everything", () => {
    expect(domainIsAllowed("github.com", [])).toBe(false);
  });
});

describe("allowsAllDomains", () => {
  test("true when list contains bare '*'", () => {
    expect(allowsAllDomains(["github.com", "*"])).toBe(true);
  });
  test("false when only wildcard-prefix patterns are present", () => {
    expect(allowsAllDomains(["*.github.com"])).toBe(false);
  });
  test("false for undefined list", () => {
    expect(allowsAllDomains(undefined)).toBe(false);
  });
});
