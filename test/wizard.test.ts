import { describe, expect, test } from "bun:test";

import type { SandboxConfig } from "../src/config.ts";
import {
  type FieldDef,
  type ScopeSituation,
  DEFAULT_RECORD_VALUE,
  FIELDS,
  addListEntry,
  addRecordKey,
  buildScopeOptions,
  formatFieldValue,
  getField,
  recordKeys,
  recordValue,
  removeField,
  removeListEntry,
  removeRecordKey,
  setField,
  toggleBool,
} from "../src/wizard.ts";

const PATHS = {
  defaultPath: "/h/.pi/agent/sandbox/default.json",
  projectsPath: "/h/.pi/agent/sandbox/projects.json",
};

const enabledField: FieldDef = FIELDS.find((f) => f.id === "enabled")!;
const allowedDomainsField: FieldDef = FIELDS.find((f) => f.id === "network.allowedDomains")!;
const ignoreViolationsField: FieldDef = FIELDS.find((f) => f.id === "ignoreViolations")!;

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
  test("record prefix count", () => {
    expect(formatFieldValue(ignoreViolationsField, { git: ["*"], "gh pr view": ["*"] })).toBe(
      "(2 prefixes) →",
    );
    expect(formatFieldValue(ignoreViolationsField, { git: ["*"] })).toBe("(1 prefix) →");
    expect(formatFieldValue(ignoreViolationsField, {})).toBe("(0 prefixes) →");
    expect(formatFieldValue(ignoreViolationsField, undefined)).toBe("(0 prefixes) →");
  });
});

describe("record editing (ignoreViolations)", () => {
  test("addRecordKey seeds new prefix with DEFAULT_RECORD_VALUE", () => {
    const out = addRecordKey({}, ignoreViolationsField, "git");
    expect(out.ignoreViolations).toEqual({ git: [...DEFAULT_RECORD_VALUE] });
  });
  test("addRecordKey trims whitespace", () => {
    const out = addRecordKey({}, ignoreViolationsField, "  gh pr view  ");
    expect(out.ignoreViolations).toEqual({ "gh pr view": ["*"] });
  });
  test("addRecordKey empty input is no-op", () => {
    const cfg: Partial<SandboxConfig> = { ignoreViolations: { git: ["*"] } };
    expect(addRecordKey(cfg, ignoreViolationsField, "")).toBe(cfg);
    expect(addRecordKey(cfg, ignoreViolationsField, "   ")).toBe(cfg);
  });
  test("addRecordKey does not overwrite existing value", () => {
    const cfg: Partial<SandboxConfig> = { ignoreViolations: { git: ["/custom"] } };
    const out = addRecordKey(cfg, ignoreViolationsField, "git");
    expect(out.ignoreViolations).toEqual({ git: ["/custom"] });
  });
  test("addRecordKey does not mutate input", () => {
    const cfg: Partial<SandboxConfig> = { ignoreViolations: { git: ["*"] } };
    addRecordKey(cfg, ignoreViolationsField, "gh pr view");
    expect(cfg.ignoreViolations).toEqual({ git: ["*"] });
  });
  test("removeRecordKey deletes a key", () => {
    const cfg: Partial<SandboxConfig> = {
      ignoreViolations: { git: ["*"], "gh pr view": ["*"] },
    };
    const out = removeRecordKey(cfg, ignoreViolationsField, "git");
    expect(out.ignoreViolations).toEqual({ "gh pr view": ["*"] });
  });
  test("removeRecordKey drops the field when last key removed", () => {
    const cfg: Partial<SandboxConfig> = { ignoreViolations: { git: ["*"] } };
    const out = removeRecordKey(cfg, ignoreViolationsField, "git");
    expect("ignoreViolations" in out).toBe(false);
  });
  test("removeRecordKey on missing key is no-op", () => {
    const cfg: Partial<SandboxConfig> = { ignoreViolations: { git: ["*"] } };
    expect(removeRecordKey(cfg, ignoreViolationsField, "nope")).toBe(cfg);
  });
  test("recordKeys returns sorted keys", () => {
    const cfg: Partial<SandboxConfig> = {
      ignoreViolations: { "gh pr view": ["*"], git: ["*"], "gh api repos/": ["*"] },
    };
    expect(recordKeys(cfg, ignoreViolationsField)).toEqual([
      "gh api repos/",
      "gh pr view",
      "git",
    ]);
  });
  test("recordKeys empty when field missing", () => {
    expect(recordKeys({}, ignoreViolationsField)).toEqual([]);
  });
  test("recordValue returns the stored array", () => {
    const cfg: Partial<SandboxConfig> = { ignoreViolations: { git: ["/foo", "/bar"] } };
    expect(recordValue(cfg, ignoreViolationsField, "git")).toEqual(["/foo", "/bar"]);
  });
  test("recordValue returns [] for missing key", () => {
    expect(recordValue({}, ignoreViolationsField, "git")).toEqual([]);
  });
});

describe("FIELDS coverage", () => {
  test("includes core fields shown by default", () => {
    const visible = FIELDS.filter((f) => !f.advanced).map((f) => f.id);
    expect(visible).toContain("enabled");
    expect(visible).toContain("network.allowedDomains");
    expect(visible).toContain("filesystem.allowWrite");
    expect(visible).toContain("filesystem.denyWrite");
    expect(visible).toContain("ignoreViolations");
  });
  test("ignoreViolations is a record field", () => {
    expect(ignoreViolationsField.kind).toBe("record");
    expect(ignoreViolationsField.path).toEqual(["ignoreViolations"]);
  });
  test("advanced fields exist but are flagged", () => {
    const adv = FIELDS.filter((f) => f.advanced).map((f) => f.id);
    expect(adv.length).toBeGreaterThan(0);
  });
});
