import { describe, expect, test } from "bun:test";

import type { SandboxConfig } from "../src/config.ts";
import {
  type FieldDef,
  type ScopeSituation,
  FIELDS,
  addListEntry,
  buildScopeOptions,
  formatFieldValue,
  getField,
  removeField,
  removeListEntry,
  setField,
  toggleBool,
} from "../src/wizard.ts";

const PATHS = {
  defaultPath: "/h/.pi/agent/sandbox/default.json",
  projectsPath: "/h/.pi/agent/sandbox/projects.json",
};

const enabledField: FieldDef = FIELDS.find((f) => f.id === "enabled")!;
const allowedDomainsField: FieldDef = FIELDS.find((f) => f.id === "network.allowedDomains")!;

describe("buildScopeOptions", () => {
  test("exact → 2 options (project + default)", () => {
    const opts = buildScopeOptions({ kind: "exact", key: "/work/foo" } as ScopeSituation, PATHS);
    expect(opts.length).toBe(2);
    expect(opts[0]?.choice).toEqual({ kind: "project-existing", key: "/work/foo" });
    expect(opts[1]?.choice).toEqual({ kind: "default" });
  });

  test("parent → 3 options (existing + new + default)", () => {
    const opts = buildScopeOptions({ kind: "parent", parent: "/work/foo", cwd: "/work/foo/sub" }, PATHS);
    expect(opts.length).toBe(3);
    expect(opts[0]?.choice).toEqual({ kind: "project-existing", key: "/work/foo" });
    expect(opts[1]?.choice).toEqual({ kind: "project-new", key: "/work/foo/sub", sourceKey: "/work/foo" });
    expect(opts[2]?.choice).toEqual({ kind: "default" });
  });

  test("none → 2 options (new project + default)", () => {
    const opts = buildScopeOptions({ kind: "none", cwd: "/work/orphan" }, PATHS);
    expect(opts.length).toBe(2);
    expect(opts[0]?.choice).toEqual({ kind: "project-new", key: "/work/orphan", sourceKey: null });
    expect(opts[1]?.choice).toEqual({ kind: "default" });
  });
});

describe("getField / setField / removeField", () => {
  test("getField navigates nested path", () => {
    const cfg: Partial<SandboxConfig> = {
      network: { allowedDomains: ["a.com"], deniedDomains: [] },
    };
    expect(getField(cfg, allowedDomainsField)).toEqual(["a.com"]);
  });

  test("getField returns undefined for missing path", () => {
    expect(getField({}, allowedDomainsField)).toBeUndefined();
  });

  test("setField creates intermediate objects", () => {
    const out = setField({}, allowedDomainsField, ["x.com"]);
    expect(out.network?.allowedDomains).toEqual(["x.com"]);
  });

  test("setField does not mutate input", () => {
    const cfg: Partial<SandboxConfig> = { network: { allowedDomains: ["a.com"], deniedDomains: [] } };
    setField(cfg, allowedDomainsField, ["b.com"]);
    expect(cfg.network?.allowedDomains).toEqual(["a.com"]);
  });

  test("removeField deletes the leaf key", () => {
    const cfg: Partial<SandboxConfig> = { enabled: true };
    const out = removeField(cfg, enabledField);
    expect("enabled" in out).toBe(false);
  });
});

describe("toggleBool", () => {
  test("undefined → true", () => {
    expect(getField(toggleBool({}, enabledField), enabledField)).toBe(true);
  });
  test("true → false", () => {
    expect(getField(toggleBool({ enabled: true }, enabledField), enabledField)).toBe(false);
  });
  test("false → undefined (key removed)", () => {
    const out = toggleBool({ enabled: false }, enabledField);
    expect("enabled" in out).toBe(false);
  });
});

describe("list editing", () => {
  test("addListEntry trims whitespace", () => {
    const out = addListEntry({}, allowedDomainsField, "  github.com  ");
    expect(out.network?.allowedDomains).toEqual(["github.com"]);
  });
  test("addListEntry dedupes", () => {
    const cfg: Partial<SandboxConfig> = { network: { allowedDomains: ["x.com"], deniedDomains: [] } };
    const out = addListEntry(cfg, allowedDomainsField, "x.com");
    expect(out.network?.allowedDomains).toEqual(["x.com"]);
  });
  test("addListEntry empty string is no-op", () => {
    const cfg: Partial<SandboxConfig> = { network: { allowedDomains: ["x.com"], deniedDomains: [] } };
    expect(addListEntry(cfg, allowedDomainsField, "")).toBe(cfg);
    expect(addListEntry(cfg, allowedDomainsField, "   ")).toBe(cfg);
  });
  test("addListEntry creates list if missing", () => {
    expect(addListEntry({}, allowedDomainsField, "x.com").network?.allowedDomains).toEqual(["x.com"]);
  });
  test("removeListEntry removes by index", () => {
    const cfg: Partial<SandboxConfig> = { network: { allowedDomains: ["a", "b", "c"], deniedDomains: [] } };
    const out = removeListEntry(cfg, allowedDomainsField, 1);
    expect(out.network?.allowedDomains).toEqual(["a", "c"]);
  });
  test("removeListEntry out-of-range is no-op", () => {
    const cfg: Partial<SandboxConfig> = { network: { allowedDomains: ["a"], deniedDomains: [] } };
    expect(removeListEntry(cfg, allowedDomainsField, 5)).toBe(cfg);
    expect(removeListEntry(cfg, allowedDomainsField, -1)).toBe(cfg);
  });
});

describe("formatFieldValue", () => {
  test("bool true/false/unset", () => {
    expect(formatFieldValue(enabledField, true)).toBe("true");
    expect(formatFieldValue(enabledField, false)).toBe("false");
    expect(formatFieldValue(enabledField, undefined)).toBe("(unset)");
  });
  test("list count", () => {
    expect(formatFieldValue(allowedDomainsField, ["a", "b"])).toBe("(2 items) →");
    expect(formatFieldValue(allowedDomainsField, ["solo"])).toBe("(1 item) →");
    expect(formatFieldValue(allowedDomainsField, [])).toBe("(0 items) →");
    expect(formatFieldValue(allowedDomainsField, undefined)).toBe("(0 items) →");
  });
});

describe("FIELDS coverage", () => {
  test("includes core fields shown by default", () => {
    const visible = FIELDS.filter((f) => !f.advanced).map((f) => f.id);
    expect(visible).toContain("enabled");
    expect(visible).toContain("network.allowedDomains");
    expect(visible).toContain("filesystem.allowWrite");
    expect(visible).toContain("filesystem.denyWrite");
  });
  test("advanced fields exist but are flagged", () => {
    const adv = FIELDS.filter((f) => f.advanced).map((f) => f.id);
    expect(adv.length).toBeGreaterThan(0);
  });
});
