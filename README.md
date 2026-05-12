# @oddsjam/pi-sandbox

OS-level sandboxing for [pi](https://pi.dev/), built on top of [`@anthropic-ai/sandbox-runtime`](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime).

![/sandbox configure wizard — current effective config rendered above the scope picker](./screenshots/sandbox-configure.png)

Heavily inspired by [`pi-sandbox`](https://github.com/carderne/pi-sandbox) by Chris Arderne (which is itself derived from Mario Zechner's example extension in [`badlogic/pi-mono`](https://github.com/badlogic/pi-mono)). This extension keeps the core idea — wrap pi's bash/read/write/edit tools with a permission gate backed by an OS-level sandbox — and adds in-TUI configuration, a shift+tab toggle, and a different storage layout that's friendlier to syncing `~/.pi/` across machines.

## What's different from pi-sandbox

| Feature | pi-sandbox | @oddsjam/pi-sandbox |
|---|---|---|
| Sandbox runtime | [`@carderne/sandbox-runtime`](https://www.npmjs.com/package/@carderne/sandbox-runtime) (fork) | **[`@anthropic-ai/sandbox-runtime`](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) (upstream, directly)** |
| Config storage | `.pi/sandbox.json` (per project) + `~/.pi/agent/sandbox.json` (global) | `~/.pi/agent/sandbox/default.json` + `~/.pi/agent/sandbox/projects.json` (single user-level dir, no per-project files) |
| Config matching | Merged global + project | Longest-prefix match, no merging — most specific wins |
| Configure in pi | None — edit JSON by hand | **`/sandbox` TUI wizard** with current-config summary, scope picker, and per-field editor |
| Toggle | `/sandbox-enable`, `/sandbox-disable` slash commands | **shift+tab** to flip on/off, with `Sandbox: disabled` in red in the footer (slash commands removed in favour of the shortcut) |
| Permission prompt | 4 options: abort / session / project / global | **5 options when in a subfolder** of an existing project key: adds "Allow for this project (new config)" which copies the parent entry under the cwd key |
| Disable cleanliness | Async reset fire-and-forget; session lists keep state across re-enable; env mutations not restored | **Awaits `SandboxManager.reset()`; drains session lists; restores env vars; detaches signal handlers** — closes a class of stale-state bugs (e.g. writes to `~/.bashrc` still being blocked after disable) |
| Process-level teardown | `session_shutdown` only | Also `SIGINT`/`SIGTERM`/`SIGHUP`/`beforeExit` — OS-level sandbox is reset on hard kills too |
| URL regex | Required two-dot domains (missed `x.com`-style hosts) | Fixed: `https?://[^\s/?#:]+` |
| Tests | None published | 133 `bun:test` tests across 11 files, hermetic via tmpdir HOME |

## How it works

### Two layers of enforcement

pi runs unsandboxed (the agent process needs `~/.pi/...` access for sessions, config, etc.). Each *tool* gets gated in its own way:

1. **Bash subprocess** — every `bash` tool call is wrapped via `SandboxManager.wrapWithSandbox(...)` from the upstream runtime. The wrapper produces a `bwrap [args] -- bash -c "socat ... apply-seccomp bash -c <user_cmd>"` invocation that:
   - sets up a Linux user/mount/PID namespace (`bubblewrap`)
   - bind-mounts `/` read-only into the namespace, masks `denyRead` paths with `tmpfs`/`/dev/null`, re-binds `allowRead` paths back on top
   - runs `apply-seccomp` to install a syscall filter that blocks Unix-socket connections to anything that isn't an allowed proxy
   - tunnels all network through an in-process HTTP/SOCKS proxy that calls back into our `SandboxAskCallback` for domain checks
   - on macOS the same surface is implemented via `sandbox-exec` instead of bubblewrap+seccomp.
2. **Read / write / edit tools** — these run in the pi (Node.js) process, *not* a subprocess, so the OS-level sandbox can't see them. We hook `pi.on("tool_call", ...)` and apply the same policy in JS:
   - `read` always prompts unless the path matches `allowRead`
   - `write` and `edit` prompt unless the path matches `allowWrite`; `denyWrite` is a hard-block, never prompted
   - the prompt's choices write back into the config (and reinitialize the bash-side sandbox so the next subprocess sees the new rules)

### Config storage

Everything lives in `~/.pi/agent/sandbox/`:

```
~/.pi/agent/sandbox/
├── default.json    # Fallback SandboxRuntimeConfig + `enabled` flag
└── projects.json   # { "<abs-project-path>": SandboxRuntimeConfig, ... }
```

- **Project lookup** uses longest-prefix match on the canonicalized cwd (symlinks resolved). `projects.json["/work/foo"]` covers `/work/foo`, `/work/foo/sub`, `/work/foo/sub/deeper`, etc.
- **No merging.** If the project entry exists, it's used in full. Otherwise `default.json` is the fallback. A project entry has the same shape as `default.json`.
- **Schema-validated** on every save via `SandboxRuntimeConfigSchema` from `@anthropic-ai/sandbox-runtime`. Invalid configs surface inline rather than corrupting the file.

The stored shape is **exactly `SandboxRuntimeConfig`** from the upstream library, plus a single extension-local `enabled` boolean. Anything documented in the upstream README works here (parent proxies, MITM, allowMachLookup, ripgrep overrides, etc.).

### Default policy

Workspace-only, matching the pattern in the [`@anthropic-ai/sandbox-runtime` docs](https://github.com/anthropic-experimental/sandbox-runtime#readme):

```json
{
  "enabled": true,
  "network": { "allowedDomains": [], "deniedDomains": [] },
  "filesystem": {
    "denyRead":  ["/Users", "/home"],
    "allowRead": [".", "~/.pi"],
    "allowWrite": ["."],
    "denyWrite": []
  }
}
```

- `denyRead: ["/Users", "/home"]` — cross-platform (`/Users` on macOS, `/home` on Linux; the path that doesn't exist on your OS is a harmless no-op).
- `allowRead: [".", "~/.pi"]` — `.` re-allows the workspace; `~/.pi` is required because the `apply-seccomp` binary that runs *inside* bubblewrap lives at `~/.pi/agent/extensions/zackify-pi-sandbox/node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp/<arch>/apply-seccomp`. Without this re-allow, the sandbox itself can't start ("apply-seccomp: No such file or directory").
- `allowWrite: ["."]` — writes restricted to the workspace.
- `allowedDomains: []` — every domain prompts on first access.

### Permission prompt

Triggered for: network domain not in `allowedDomains`, read path not in `allowRead`, write/edit path not in `allowWrite`. denyWrite hard-blocks with no prompt.

The option set is context-aware based on whether your cwd matches an entry in `projects.json`:

```
Exact match (cwd === some project key):
  [esc]  Abort
  [s]    Allow for this session only
  [P]    Allow for this project       → projects.json["/work/foo"]
  [A]    Allow for all projects       → default.json

Parent match (cwd is inside an existing project key):
  [esc]  Abort
  [s]    Allow for this session only
  [P]    Allow for this project (parent: /work/foo)
  [N]    Allow for this project (new config: /work/foo/sub)  ← copies parent entry under the cwd key, then adds the new item
  [A]    Allow for all projects

No match (no project key covers cwd):
  [esc]  Abort
  [s]    Allow for this session only
  [P]    Allow for this project       → seeds new entry from default.json
  [A]    Allow for all projects
```

Lowercase letter → requires Enter to confirm. Uppercase letter → commits immediately. `[s]` (session) and `[esc]` (abort) don't require confirm in either case. Session allowances live in JS memory only — they're never written to disk and the agent has no way to inspect them.

### `/sandbox` — in-pi inspection + configuration

`/sandbox` opens a TUI wizard. There used to be a separate `/sandbox-configure` command — inspection and configuration are now the same command, since you almost always want to see what's currently enforced before changing it.

1. **Scope picker** — the current effective config is rendered as a summary header (allowed domains, read/write paths, deny lists, session allowances, scope), then the picker lets you choose which file/key to edit. Same situation logic as the permission prompt: exact / parent / none, with a "Create new project config (copied from parent)" option when you're in a subfolder of an existing key, and an "Edit default config" option always available.
2. **Field editor** — list of every `SandboxRuntimeConfig` field with current values. `↑↓` to navigate, `enter` to toggle/open, `s` to save, `?` to show advanced fields (`enableWeakerNestedSandbox`, `allowPty`, `mandatoryDenySearchDepth`, …), `esc`/`q` to quit.
3. **List editor** — drill into list fields (`allowedDomains`, `allowRead`, …) to add (`a`) and delete (`d`) entries.

Save validates the draft against `SandboxRuntimeConfigSchema` and surfaces validation errors inline rather than writing invalid JSON. The sandbox is reinitialized after each save so changes take effect immediately.

### Status line + shift+tab

The footer shows one of two states:

- **Enabled** (accent colour): `🔒 Sandbox: 3 domains, 2 write paths`
- **Disabled** (`disabled` in red): `Sandbox: disabled`

**Shift+Tab toggles between them.** Toggling off runs the full disable path (see below); toggling on calls `SandboxManager.initialize` and re-attaches process-level teardown handlers. Both produce a notification.

The default keybinding for `shift+tab` in pi is `app.thinking.cycle`. If you want shift+tab for sandbox toggling, unbind it in `~/.pi/agent/keybindings.json`:

```json
{ "app.thinking.cycle": [] }
```

### Disable cleanliness (the bug fix)

pi-sandbox has a few small leaks around `/sandbox-disable`:

- `SandboxManager.reset()` was fire-and-forget from the command handler — could return before teardown actually completed.
- In-memory session allowances weren't cleared, so re-enabling in the same process started with stale state.
- The `NODE_USE_ENV_PROXY=1` env mutation wasn't reverted.
- The post-bash "Operation not permitted" scanner could still fire on output containing that substring even after disable, triggering spurious write prompts (this is the source of the "writes to `~/.bashrc` still blocked after disable" symptom).

This extension's `performDisable` (in `src/disable.ts`) does all of:

1. `await SandboxManager.reset()` (awaited, error captured into result).
2. Drain `sessionAllowedDomains`, `sessionAllowedReadPaths`, `sessionAllowedWritePaths` in place.
3. Flip both `enabled` and `initialized` flags to false (the post-bash scanner checks **both**, so this fully bypasses it).
4. Restore env vars via an `EnvTracker` that recorded the originals when they were first set.
5. Detach the `SIGINT`/`SIGTERM`/`SIGHUP`/`beforeExit` handlers we attached at init time.

Each of those steps has its own unit test.

### Teardown on hard kills

`session_shutdown` covers graceful pi exits but doesn't fire on SIGINT/SIGTERM/SIGHUP. `src/teardown.ts` attaches process-level handlers that:

- On signal: detach our own handlers (so re-raising doesn't loop), run `SandboxManager.reset()`, then re-raise the same signal so pi's own handler still runs.
- On `beforeExit`: best-effort reset.

All idempotent — multiple signals during shutdown still produce exactly one teardown.

## File layout

```
zackify-pi-sandbox/                  # folder on disk (kept unchanged for sync stability)
├── package.json                  "@oddsjam/pi-sandbox", trustedDependencies: ["@anthropic-ai/sandbox-runtime"]
├── tsconfig.json                 strict, allowImportingTsExtensions, noUncheckedIndexedAccess
├── README.md                     this file
├── index.ts                      extension entry: hooks, commands, lifecycle, shift+tab shortcut
├── src/
│   ├── paths.ts                  expandPath / canonicalizePath / matchesPattern / longestPrefixMatch
│   ├── domains.ts                URL extraction + wildcard domain matching
│   ├── output.ts                 extractBlockedWritePath (parses bash "Operation not permitted")
│   ├── config.ts                 default.json + projects.json IO, longest-prefix lookup,
│   │                             append* mutators, seedNewProjectEntry, validateConfig
│   ├── prompt.ts                 pure state machine for the permission prompt (context-aware)
│   ├── prompt-ui.ts              TUI adapter using ctx.ui.custom
│   ├── wizard.ts                 pure field/scope state for /sandbox-configure
│   ├── wizard-ui.ts              TUI adapter for the wizard
│   ├── bash-ops.ts               sandbox-wrapped child_process.spawn
│   ├── status.ts                 "🔒 Sandbox: …" / "Sandbox: disabled" renderers
│   ├── summary.ts                /sandbox summary-line builder (rendered above the scope picker)
│   ├── env.ts                    EnvTracker for safely mutating + restoring process.env
│   ├── disable.ts                performDisable orchestration (testable)
│   └── teardown.ts               attachTeardown for SIGINT/SIGTERM/SIGHUP/beforeExit
└── test/                         11 files, 133 bun:test tests, hermetic tmpdir HOME
```

## Commands and keybindings

| Trigger | Effect |
|---|---|
| `/sandbox` | Show effective config + scope + session allowances **and** open the configure wizard (summary is rendered above the scope picker) |
| `shift+tab` | Toggle sandbox on/off (requires `app.thinking.cycle` unbound). Off does a full disable (no leaks; see "Disable cleanliness" above). |
| `--no-sandbox` CLI flag | Start with the sandbox disabled |

## Install

Auto-discovered when placed at `~/.pi/agent/extensions/zackify-pi-sandbox/` (the folder name on disk is unchanged; the npm-style `name` in `package.json` is `@oddsjam/pi-sandbox`). Sync `~/.pi/` to other machines and pi picks it up there too.

```bash
cd ~/.pi/agent/extensions/zackify-pi-sandbox
bun install
```

`@anthropic-ai/sandbox-runtime` is listed in `trustedDependencies` so bun doesn't block its install lifecycle.

### Prerequisites

- **Linux:** `bwrap` (bubblewrap), `socat`, `ripgrep` (`rg`) — pi's bash launch PATH must include these.
- **macOS:** `sandbox-exec` (ships with macOS), `ripgrep` (`rg`).

If `apply-seccomp: No such file or directory` appears, your `~/.pi/agent/sandbox/default.json` is missing `~/.pi` in `allowRead`. Add it via `/sandbox-configure` and save — `~/.pi` must be visible inside the sandbox because the seccomp binary lives there.

## Tests

```bash
bun test         # 133 tests across 11 files
bun run typecheck
```

Pure modules are unit-tested directly with synthetic state machines and a tmpdir HOME. TUI adapters and `SandboxManager` integration aren't exercised in `bun test` because they're stateful and platform-bound — verify those by running pi.

## Acknowledgements

- [`pi-sandbox`](https://github.com/carderne/pi-sandbox) by Chris Arderne — the design this extension is built on. Most of the policy semantics (read-prompts-everything, denyWrite-overrides-allowWrite, the 4-way prompt) come from there.
- [`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) by Mario Zechner — the original example extension that pi-sandbox forked from. Used under the [MIT License](https://github.com/badlogic/pi-mono/blob/main/LICENSE).
- [`@anthropic-ai/sandbox-runtime`](https://github.com/anthropic-experimental/sandbox-runtime) — the upstream OS-level sandbox library. Used directly here without forking.
