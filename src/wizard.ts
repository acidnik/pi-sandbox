/**
 * /sandbox-configure wizard — pure state machine.
 *
 * The wizard has three views:
 *   1. "scope"  — pick which config file/key to edit (skipped when only one
 *                 sensible target exists, e.g. cwd === project key exactly).
 *   2. "main"   — list of top-level config keys with current values.
 *   3. "list"   — drill into a list field (allowedDomains, allowRead, …) to
 *                 add and remove entries.
 *
 * All persistence (reading/writing default.json + projects.json) and TUI
 * concerns live in wizard-ui.ts. This module only knows about the in-memory
 * draft and how it should change in response to user actions.
 */

import type { SandboxConfig } from "./config.ts";

// ── Field definitions ───────────────────────────────────────────────────────

export type FieldKind = "bool" | "list" | "string" | "number" | "record";

export interface FieldDef {
  /** Display label and stable id (also the array index path). */
  id: string;
  label: string;
  kind: FieldKind;
  /** Dot path into the SandboxConfig object. */
  path: readonly string[];
  /** Whether to hide in the main view (advanced fields are off by default). */
  advanced?: boolean;
}

/**
 * The fields exposed in the wizard. Order matches the rendered list. We
 * deliberately keep the surface small — niche fields (mitmProxy, parentProxy,
 * seccomp, ripgrep, bwrapPath, socatPath, httpProxyPort, socksProxyPort) are
 * left for raw-JSON editing because their nested object shapes don't fit a
 * single-keystroke UI.
 */
export const FIELDS: readonly FieldDef[] = [
  { id: "enabled", label: "enabled", kind: "bool", path: ["enabled"] },
  { id: "network.allowedDomains", label: "network.allowedDomains", kind: "list", path: ["network", "allowedDomains"] },
  { id: "network.deniedDomains", label: "network.deniedDomains", kind: "list", path: ["network", "deniedDomains"] },
  { id: "network.allowLocalBinding", label: "network.allowLocalBinding", kind: "bool", path: ["network", "allowLocalBinding"] },
  { id: "network.allowAllUnixSockets", label: "network.allowAllUnixSockets", kind: "bool", path: ["network", "allowAllUnixSockets"] },
  { id: "network.allowUnixSockets", label: "network.allowUnixSockets", kind: "list", path: ["network", "allowUnixSockets"], advanced: true },
  { id: "network.allowMachLookup", label: "network.allowMachLookup", kind: "list", path: ["network", "allowMachLookup"], advanced: true },
  { id: "filesystem.allowRead", label: "filesystem.allowRead", kind: "list", path: ["filesystem", "allowRead"] },
  { id: "filesystem.denyRead", label: "filesystem.denyRead", kind: "list", path: ["filesystem", "denyRead"] },
  { id: "filesystem.allowWrite", label: "filesystem.allowWrite", kind: "list", path: ["filesystem", "allowWrite"] },
  { id: "filesystem.denyWrite", label: "filesystem.denyWrite", kind: "list", path: ["filesystem", "denyWrite"] },
  { id: "filesystem.allowGitConfig", label: "filesystem.allowGitConfig", kind: "bool", path: ["filesystem", "allowGitConfig"] },
  { id: "ignoreViolations", label: "ignoreViolations", kind: "record", path: ["ignoreViolations"] },
  { id: "enableWeakerNestedSandbox", label: "enableWeakerNestedSandbox", kind: "bool", path: ["enableWeakerNestedSandbox"], advanced: true },
  { id: "enableWeakerNetworkIsolation", label: "enableWeakerNetworkIsolation", kind: "bool", path: ["enableWeakerNetworkIsolation"], advanced: true },
  { id: "allowPty", label: "allowPty", kind: "bool", path: ["allowPty"], advanced: true },
  { id: "mandatoryDenySearchDepth", label: "mandatoryDenySearchDepth", kind: "number", path: ["mandatoryDenySearchDepth"], advanced: true },
];

// ── Scope ───────────────────────────────────────────────────────────────────

export type ScopeChoice =
  | { kind: "default" }
  | { kind: "project-existing"; key: string }
  | { kind: "project-new"; key: string; sourceKey: string | null };

export type ScopeSituation =
  | { kind: "exact"; key: string }                                  // cwd is a key in projects.json
  | { kind: "parent"; parent: string; cwd: string }                 // cwd is inside an existing key
  | { kind: "none"; cwd: string };                                  // no matching project key

export interface ScopeOption {
  choice: ScopeChoice;
  label: string;
  hint: string;
}

/** Build the scope picker options for a given situation. */
export function buildScopeOptions(
  situation: ScopeSituation,
  paths: { defaultPath: string; projectsPath: string },
): ScopeOption[] {
  const opts: ScopeOption[] = [];
  if (situation.kind === "exact") {
    opts.push({
      choice: { kind: "project-existing", key: situation.key },
      label: "Edit project config",
      hint: `${paths.projectsPath}["${situation.key}"]`,
    });
  } else if (situation.kind === "parent") {
    opts.push({
      choice: { kind: "project-existing", key: situation.parent },
      label: "Edit project config (parent)",
      hint: `${paths.projectsPath}["${situation.parent}"]`,
    });
    opts.push({
      choice: { kind: "project-new", key: situation.cwd, sourceKey: situation.parent },
      label: "Create new project config",
      hint: `${paths.projectsPath}["${situation.cwd}"]  (copied from "${situation.parent}")`,
    });
  } else {
    opts.push({
      choice: { kind: "project-new", key: situation.cwd, sourceKey: null },
      label: "Create project config",
      hint: `${paths.projectsPath}["${situation.cwd}"]  (seeded from default.json)`,
    });
  }
  opts.push({
    choice: { kind: "default" },
    label: "Edit default config",
    hint: paths.defaultPath,
  });
  return opts;
}

// ── Draft mutation ──────────────────────────────────────────────────────────

/** Read a nested value following the field path. */
export function getField(config: Partial<SandboxConfig>, field: FieldDef): unknown {
  let cur: unknown = config;
  for (const seg of field.path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Set a nested value, creating intermediate objects as needed. Mutates a clone. */
export function setField(
  config: Partial<SandboxConfig>,
  field: FieldDef,
  value: unknown,
): Partial<SandboxConfig> {
  const next = structuredClone(config) as Record<string, unknown>;
  let cur = next;
  for (let i = 0; i < field.path.length - 1; i++) {
    const seg = field.path[i];
    if (seg === undefined) continue;
    const existing = cur[seg];
    if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      cur[seg] = {};
    }
    cur = cur[seg] as Record<string, unknown>;
  }
  const last = field.path[field.path.length - 1];
  if (last !== undefined) cur[last] = value;
  return next as Partial<SandboxConfig>;
}

/** Toggle a boolean field. Undefined becomes true; true→false; false→undefined (omit). */
export function toggleBool(
  config: Partial<SandboxConfig>,
  field: FieldDef,
): Partial<SandboxConfig> {
  const cur = getField(config, field);
  if (cur === true) return setField(config, field, false);
  if (cur === false) return removeField(config, field);
  return setField(config, field, true);
}

/** Remove a field by setting its key to undefined and dropping it. */
export function removeField(
  config: Partial<SandboxConfig>,
  field: FieldDef,
): Partial<SandboxConfig> {
  const next = structuredClone(config) as Record<string, unknown>;
  let cur = next;
  for (let i = 0; i < field.path.length - 1; i++) {
    const seg = field.path[i];
    if (seg === undefined) continue;
    const child = cur[seg];
    if (child === null || typeof child !== "object") return next as Partial<SandboxConfig>;
    cur = child as Record<string, unknown>;
  }
  const last = field.path[field.path.length - 1];
  if (last !== undefined) delete cur[last];
  return next as Partial<SandboxConfig>;
}

/**
 * Default value array assigned to newly-added record keys (ignoreViolations
 * entries). Matches every path/violation the prefix could possibly emit.
 */
export const DEFAULT_RECORD_VALUE: readonly string[] = ["*"];

/** Read a record-field as a plain object, or {} if missing/wrong type. */
function getRecord(
  config: Partial<SandboxConfig>,
  field: FieldDef,
): Record<string, string[]> {
  const cur = getField(config, field);
  if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return {};
  // Filter to only string-array values; tolerate stray junk.
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      out[k] = v as string[];
    }
  }
  return out;
}

/** Sorted list of keys from a record field. Pure helper for the UI. */
export function recordKeys(config: Partial<SandboxConfig>, field: FieldDef): string[] {
  return Object.keys(getRecord(config, field)).sort();
}

/** Get the value array for a record key, or [] if missing. */
export function recordValue(
  config: Partial<SandboxConfig>,
  field: FieldDef,
  key: string,
): readonly string[] {
  const rec = getRecord(config, field);
  return rec[key] ?? [];
}

/**
 * Add a key to a record field. Trims whitespace. Empty → no-op. Existing
 * keys are left alone (no overwrite of the value array). New keys are
 * seeded with `DEFAULT_RECORD_VALUE` (`["*"]`).
 */
export function addRecordKey(
  config: Partial<SandboxConfig>,
  field: FieldDef,
  key: string,
): Partial<SandboxConfig> {
  const trimmed = key.trim();
  if (!trimmed) return config;
  const rec = getRecord(config, field);
  if (Object.prototype.hasOwnProperty.call(rec, trimmed)) return config;
  const next = { ...rec, [trimmed]: [...DEFAULT_RECORD_VALUE] };
  return setField(config, field, next);
}

/** Remove a key from a record field. Missing key → no-op. */
export function removeRecordKey(
  config: Partial<SandboxConfig>,
  field: FieldDef,
  key: string,
): Partial<SandboxConfig> {
  const rec = getRecord(config, field);
  if (!Object.prototype.hasOwnProperty.call(rec, key)) return config;
  const next = { ...rec };
  delete next[key];
  // Empty record → drop the field entirely so it doesn't clutter the JSON.
  if (Object.keys(next).length === 0) return removeField(config, field);
  return setField(config, field, next);
}

/** Add an entry to a list field. Dedupes. Trims whitespace. Empty → no-op. */
export function addListEntry(
  config: Partial<SandboxConfig>,
  field: FieldDef,
  entry: string,
): Partial<SandboxConfig> {
  const trimmed = entry.trim();
  if (!trimmed) return config;
  const cur = getField(config, field);
  const list: string[] = Array.isArray(cur) ? (cur as string[]).slice() : [];
  if (list.includes(trimmed)) return config;
  list.push(trimmed);
  return setField(config, field, list);
}

export function removeListEntry(
  config: Partial<SandboxConfig>,
  field: FieldDef,
  index: number,
): Partial<SandboxConfig> {
  const cur = getField(config, field);
  if (!Array.isArray(cur)) return config;
  if (index < 0 || index >= cur.length) return config;
  const list = (cur as string[]).slice();
  list.splice(index, 1);
  return setField(config, field, list);
}

/** Display a value for the main list row. */
export function formatFieldValue(field: FieldDef, value: unknown): string {
  if (field.kind === "list") {
    const arr = Array.isArray(value) ? value : [];
    return `(${arr.length} ${arr.length === 1 ? "item" : "items"}) →`;
  }
  if (field.kind === "record") {
    const n =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value as Record<string, unknown>).length
        : 0;
    return `(${n} ${n === 1 ? "prefix" : "prefixes"}) →`;
  }
  if (field.kind === "bool") {
    if (value === true) return "true";
    if (value === false) return "false";
    return "(unset)";
  }
  if (value === undefined || value === null) return "(unset)";
  return String(value);
}
