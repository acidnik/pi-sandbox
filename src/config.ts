/**
 * Config storage.
 *
 * Two files under a single user-level directory (configurable via
 * `sandboxDir`, defaults to `~/.pi/agent/sandbox`):
 *
 *   default.json   — fallback SandboxRuntimeConfig used when cwd has no
 *                    matching project entry.
 *   projects.json  — { "<abs-project-path>": SandboxRuntimeConfig, ... }
 *
 * Project lookup uses longest-prefix match (so /work/foo matches /work/foo/sub).
 * Neither file is merged — the most specific match wins. Session allowances
 * (in-memory, owned by the extension) are layered on top at runtime.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  type SandboxRuntimeConfig,
  SandboxRuntimeConfigSchema,
} from "@anthropic-ai/sandbox-runtime";

import { canonicalizePath, longestPrefixMatch } from "./paths.ts";

/**
 * Our stored config: identical to SandboxRuntimeConfig, plus an `enabled`
 * toggle that the extension reads but the sandbox-runtime library doesn't
 * know or care about.
 */
export type SandboxConfig = SandboxRuntimeConfig & { enabled?: boolean };

/** Shape of projects.json on disk. Values may be partial during editing. */
export type ProjectsConfig = Record<string, Partial<SandboxConfig>>;

export interface ConfigPaths {
  dir: string;
  defaultPath: string;
  projectsPath: string;
}

export function getConfigPaths(home: string = homedir()): ConfigPaths {
  const dir = join(home, ".pi", "agent", "sandbox");
  return {
    dir,
    defaultPath: join(dir, "default.json"),
    projectsPath: join(dir, "projects.json"),
  };
}

/**
 * Built-in defaults used the first time the extension runs (and as an
 * in-memory fallback when default.json is missing or empty).
 *
 * Follows the "workspace-only filesystem access" pattern from the
 * @anthropic-ai/sandbox-runtime docs: deny reads under all user home dirs
 * (/Users on macOS, /home on Linux — both listed for cross-platform sync),
 * then re-allow the cwd via `.` and `~/.pi` for the pi config tree.
 *
 * `~/.pi` is re-allowed because pi's own files live there — most notably
 * the @anthropic-ai/sandbox-runtime apply-seccomp binary at
 * `~/.pi/agent/extensions/zackify-pi-sandbox/node_modules/.../vendor/seccomp/<arch>/apply-seccomp`,
 * which must be visible inside the bubblewrap sandbox or the entire sandbox
 * fails to start with "apply-seccomp: No such file or directory". System
 * paths (/usr, /lib, /etc, ...) remain readable so common tooling works.
 *
 * Secrets re-denied on top of the `~/.pi` re-allow:
 *  - `~/.pi/agent/auth.json` — pi's primary auth token store
 *  - `~/.pi/agent/mcp-oauth` — MCP OAuth tokens directory
 *
 * @anthropic-ai/sandbox-runtime gives file-level denyRead precedence over
 * directory-level allowRead ancestors, so these specific paths stay
 * blocked even though their parent `~/.pi` directory is re-allowed.
 *
 * Every network access prompts because allowedDomains is empty.
 */
export const BUILTIN_DEFAULT_CONFIG: SandboxConfig = {
  enabled: false,
  filesystem: {
    denyRead: ["/Users", "/home", "~/.pi/agent/auth.json", "~/.pi/agent/mcp-oauth"],
    allowRead: [".", "~/.pi"],
    allowWrite: ["."],
    denyWrite: ["~/.pi/agent/auth.json", "~/.pi/agent/mcp-oauth"],
  },
};

// ── file IO ──────────────────────────────────────────────────────────────────

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

export function readDefault(home: string = homedir()): Partial<SandboxConfig> {
  const { defaultPath } = getConfigPaths(home);
  const raw = readJson<Partial<SandboxConfig>>(defaultPath);
  return raw ?? {};
}

export function readProjects(home: string = homedir()): ProjectsConfig {
  const { projectsPath } = getConfigPaths(home);
  const raw = readJson<ProjectsConfig>(projectsPath);
  return raw ?? {};
}

export function writeDefault(value: Partial<SandboxConfig>, home: string = homedir()): void {
  const { defaultPath } = getConfigPaths(home);
  writeJson(defaultPath, value);
}

export function writeProjects(value: ProjectsConfig, home: string = homedir()): void {
  const { projectsPath } = getConfigPaths(home);
  writeJson(projectsPath, value);
}

/** Initialize default.json with built-in defaults if it doesn't exist. */
export function ensureDefaultConfig(home: string = homedir()): void {
  const { defaultPath } = getConfigPaths(home);
  if (!existsSync(defaultPath)) writeDefault(BUILTIN_DEFAULT_CONFIG, home);
}

// ── validation ───────────────────────────────────────────────────────────────

/**
 * Validate that a partial config conforms to SandboxRuntimeConfig. Returns
 * either the validated config or the validation error message. We accept the
 * `enabled` extra field (it's stripped before validation).
 */
export function validateConfig(
  value: Partial<SandboxConfig>,
): { ok: true; config: SandboxConfig } | { ok: false; error: string } {
  const { enabled, ...rest } = value;
  const parsed = SandboxRuntimeConfigSchema.safeParse(rest);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  const config: SandboxConfig = parsed.data;
  if (enabled !== undefined) config.enabled = enabled;
  return { ok: true, config };
}

// ── lookup ───────────────────────────────────────────────────────────────────

export interface EffectiveLookup {
  /** The chosen project key, or null if falling back to default. */
  projectKey: string | null;
  /** The chosen config (project entry or default), without session overlay. */
  base: Partial<SandboxConfig>;
}

/** Find the project key (longest-prefix match) for a given cwd. */
export function findProjectKey(cwd: string, projects: ProjectsConfig): string | null {
  const canonical = canonicalizePath(cwd);
  return longestPrefixMatch(canonical, Object.keys(projects));
}

export function loadEffectiveBase(cwd: string, home: string = homedir()): EffectiveLookup {
  const projects = readProjects(home);
  const def = readDefault(home);
  const key = findProjectKey(cwd, projects);
  const base = key !== null ? (projects[key] ?? def) : def;
  return { projectKey: key, base };
}

/**
 * Layer session-only allowances over a stored config. Session lists are
 * appended to allowedDomains, allowRead, and allowWrite.
 */
export interface SessionOverlay {
  domains?: readonly string[];
  readPaths?: readonly string[];
  writePaths?: readonly string[];
}

export function applySessionOverlay(
  base: Partial<SandboxConfig>,
  session: SessionOverlay,
): Partial<SandboxConfig> {
  const network = base.network
    ? {
        ...base.network,
        allowedDomains: [...(base.network.allowedDomains ?? []), ...(session.domains ?? [])],
      }
    : base.network;
  const filesystem = base.filesystem
    ? {
        ...base.filesystem,
        allowRead: [...(base.filesystem.allowRead ?? []), ...(session.readPaths ?? [])],
        allowWrite: [...(base.filesystem.allowWrite ?? []), ...(session.writePaths ?? [])],
      }
    : base.filesystem;
  return { ...base, network, filesystem };
}

// ── mutators ─────────────────────────────────────────────────────────────────

/**
 * Resolve where a "Allow for this project" choice should write to, *without*
 * actually writing. Used to compute the displayed hint in the prompt.
 *
 * - If a parent prefix already exists in projects.json, return that key
 *   (append-mode).
 * - Otherwise, return the canonicalized cwd (create-fresh-mode).
 */
export function resolveProjectAppendKey(cwd: string, projects: ProjectsConfig): string {
  const existing = findProjectKey(cwd, projects);
  return existing ?? canonicalizePath(cwd);
}

/**
 * Seed a new project entry. If a `sourceKey` is supplied and exists in
 * `projects`, deep-clone that entry as the seed. Otherwise, deep-clone the
 * `defaults` value. If the source is malformed, fall back to defaults and
 * invoke `onInvalid` (the UI surfaces this as a warning).
 */
export function seedNewProjectEntry(
  projects: ProjectsConfig,
  defaults: Partial<SandboxConfig>,
  sourceKey: string | null,
  newKey: string,
  onInvalid?: (msg: string) => void,
): ProjectsConfig {
  let seed: Partial<SandboxConfig>;
  if (sourceKey && projects[sourceKey]) {
    const candidate = structuredClone(projects[sourceKey]);
    const validation = validateConfig(candidate);
    if (validation.ok) {
      seed = candidate;
    } else {
      onInvalid?.(`Parent config at "${sourceKey}" is invalid (${validation.error}); seeding from default.json instead.`);
      seed = structuredClone(defaults);
    }
  } else {
    seed = structuredClone(defaults);
  }
  return { ...projects, [newKey]: seed };
}

/** Append a domain to a project entry (or default), creating fields as needed. */
export function appendDomain(target: Partial<SandboxConfig>, domain: string): Partial<SandboxConfig> {
  const existing = target.network?.allowedDomains ?? [];
  if (existing.includes(domain)) return target;
  return {
    ...target,
    network: {
      ...target.network,
      allowedDomains: [...existing, domain],
      deniedDomains: target.network?.deniedDomains ?? [],
    },
  };
}

export function appendReadPath(target: Partial<SandboxConfig>, path: string): Partial<SandboxConfig> {
  const existing = target.filesystem?.allowRead ?? [];
  if (existing.includes(path)) return target;
  return {
    ...target,
    filesystem: {
      ...target.filesystem,
      allowRead: [...existing, path],
      denyRead: target.filesystem?.denyRead ?? [],
      allowWrite: target.filesystem?.allowWrite ?? [],
      denyWrite: target.filesystem?.denyWrite ?? [],
    },
  };
}

export function appendWritePath(target: Partial<SandboxConfig>, path: string): Partial<SandboxConfig> {
  const existing = target.filesystem?.allowWrite ?? [];
  if (existing.includes(path)) return target;
  return {
    ...target,
    filesystem: {
      ...target.filesystem,
      allowWrite: [...existing, path],
      denyRead: target.filesystem?.denyRead ?? [],
      allowRead: target.filesystem?.allowRead ?? [],
      denyWrite: target.filesystem?.denyWrite ?? [],
    },
  };
}
