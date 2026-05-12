/**
 * Permission prompt — pure state machine.
 *
 * The TUI adapter lives in prompt-ui.ts; this file is keyboard-driven logic
 * only, so it can be unit-tested with synthetic keystrokes.
 */

export type PromptAction =
  | { kind: "abort" }
  | { kind: "session" }
  | { kind: "project-append"; targetKey: string }
  | { kind: "project-new"; targetKey: string }
  | { kind: "global" };

export type PromptOption =
  | { kind: "abort"; key: "esc"; label: string }
  | { kind: "session"; key: "s"; label: string }
  | { kind: "project-append"; key: "p"; label: string; targetKey: string; hint: string; confirm: true }
  | { kind: "project-new"; key: "n"; label: string; targetKey: string; hint: string; confirm: true }
  | { kind: "global"; key: "a"; label: string; hint: string; confirm: true };

export type ProjectSituation =
  | { kind: "exact"; key: string }     // cwd is an exact key in projects.json
  | { kind: "parent"; parent: string; cwd: string } // cwd is inside an existing key
  | { kind: "none"; cwd: string };     // no matching key

export interface BuildOptionsArgs {
  situation: ProjectSituation;
  defaultPath: string;
  projectsPath: string;
}

/**
 * Build the option list shown to the user. Order matches the rendered list.
 *
 *   abort, session, project-append [, project-new], global
 *
 * project-new only appears when situation.kind === "parent".
 */
export function buildPromptOptions(args: BuildOptionsArgs): PromptOption[] {
  const { situation, defaultPath, projectsPath } = args;
  const opts: PromptOption[] = [
    { kind: "abort", key: "esc", label: "Abort (keep blocked)" },
    { kind: "session", key: "s", label: "Allow for this session only" },
  ];

  if (situation.kind === "exact") {
    opts.push({
      kind: "project-append",
      key: "p",
      label: "Allow for this project",
      targetKey: situation.key,
      hint: `→ ${projectsPath}["${situation.key}"]`,
      confirm: true,
    });
  } else if (situation.kind === "parent") {
    opts.push({
      kind: "project-append",
      key: "p",
      label: `Allow for this project (parent: ${situation.parent})`,
      targetKey: situation.parent,
      hint: `→ ${projectsPath}["${situation.parent}"]`,
      confirm: true,
    });
    opts.push({
      kind: "project-new",
      key: "n",
      label: `Allow for this project (new config: ${situation.cwd})`,
      targetKey: situation.cwd,
      hint: `→ ${projectsPath}["${situation.cwd}"]  (copied from "${situation.parent}")`,
      confirm: true,
    });
  } else {
    opts.push({
      kind: "project-append",
      key: "p",
      label: "Allow for this project",
      targetKey: situation.cwd,
      hint: `→ ${projectsPath}["${situation.cwd}"]  (new, seeded from default.json)`,
      confirm: true,
    });
  }

  opts.push({
    kind: "global",
    key: "a",
    label: "Allow for all projects",
    hint: `→ ${defaultPath}`,
    confirm: true,
  });

  return opts;
}

// ── State machine ───────────────────────────────────────────────────────────

export interface PromptState {
  options: PromptOption[];
  selectedIndex: number;
  /** When set, Enter confirms this action; arrow keys clear it. */
  pendingIndex: number | null;
}

export function initPromptState(options: PromptOption[]): PromptState {
  return { options, selectedIndex: 0, pendingIndex: null };
}

export type PromptKey =
  | { kind: "char"; value: string } // raw character ("p", "P", "s", "a", "A")
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "enter" }
  | { kind: "escape" };

export type PromptStep =
  | { kind: "render"; state: PromptState }
  | { kind: "resolve"; action: PromptAction };

/** Convert a selected option into its action. */
function optionToAction(opt: PromptOption): PromptAction {
  switch (opt.kind) {
    case "abort":
      return { kind: "abort" };
    case "session":
      return { kind: "session" };
    case "project-append":
      return { kind: "project-append", targetKey: opt.targetKey };
    case "project-new":
      return { kind: "project-new", targetKey: opt.targetKey };
    case "global":
      return { kind: "global" };
  }
}

/**
 * Apply a key event to the prompt state. Returns either a new state (caller
 * should re-render) or a resolution action (caller should write+exit).
 */
export function stepPromptState(state: PromptState, key: PromptKey): PromptStep {
  if (key.kind === "escape") {
    return { kind: "resolve", action: { kind: "abort" } };
  }

  if (key.kind === "up") {
    return {
      kind: "render",
      state: { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1), pendingIndex: null },
    };
  }
  if (key.kind === "down") {
    return {
      kind: "render",
      state: {
        ...state,
        selectedIndex: Math.min(state.options.length - 1, state.selectedIndex + 1),
        pendingIndex: null,
      },
    };
  }

  if (key.kind === "enter") {
    if (state.pendingIndex !== null) {
      const opt = state.options[state.pendingIndex];
      if (opt) return { kind: "resolve", action: optionToAction(opt) };
    }
    const opt = state.options[state.selectedIndex];
    if (!opt) return { kind: "resolve", action: { kind: "abort" } };
    // For confirm-required options, Enter on a non-pending selection puts it
    // in the pending state rather than committing.
    if ("confirm" in opt && opt.confirm) {
      return { kind: "render", state: { ...state, pendingIndex: state.selectedIndex } };
    }
    return { kind: "resolve", action: optionToAction(opt) };
  }

  // char
  for (let i = 0; i < state.options.length; i++) {
    const opt = state.options[i];
    if (!opt) continue;
    if (opt.key === "esc") continue;
    const optKey = opt.key;
    // Uppercase exact match → immediate commit (skips confirm step).
    if (key.value === optKey.toUpperCase()) {
      return { kind: "resolve", action: optionToAction(opt) };
    }
    // Lowercase match → confirm step for confirm-required options, immediate
    // for non-confirm (abort and session).
    if (key.value === optKey) {
      if ("confirm" in opt && opt.confirm) {
        return { kind: "render", state: { ...state, selectedIndex: i, pendingIndex: i } };
      }
      return { kind: "resolve", action: optionToAction(opt) };
    }
  }

  return { kind: "render", state };
}
