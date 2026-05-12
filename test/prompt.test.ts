import { describe, expect, test } from "bun:test";

import {
  type PromptKey,
  type PromptOption,
  type ProjectSituation,
  buildPromptOptions,
  initPromptState,
  stepPromptState,
} from "../src/prompt.ts";

// Neutral path fixtures — buildPromptOptions only embeds them into hint
// strings, so any non-empty value works for the assertions.
const PATHS = {
  defaultPath: "/tmp/sandbox/default.json",
  projectsPath: "/tmp/sandbox/projects.json",
};

function press(opts: PromptOption[], keys: PromptKey[]) {
  let state = initPromptState(opts);
  for (const k of keys) {
    const step = stepPromptState(state, k);
    if (step.kind === "resolve") return step.action;
    state = step.state;
  }
  return { state, action: null as null };
}

describe("buildPromptOptions", () => {
  test("exact match: abort/session/project-append/global (4 options, no new)", () => {
    const opts = buildPromptOptions({
      situation: { kind: "exact", key: "/work/foo" },
      ...PATHS,
    });
    expect(opts.map((o) => o.kind)).toEqual(["abort", "session", "project-append", "global"]);
    const proj = opts.find((o) => o.kind === "project-append")!;
    expect(proj.kind === "project-append" && proj.targetKey).toBe("/work/foo");
  });

  test("parent match: 5 options including project-new", () => {
    const opts = buildPromptOptions({
      situation: { kind: "parent", parent: "/work/foo", cwd: "/work/foo/sub" },
      ...PATHS,
    });
    expect(opts.map((o) => o.kind)).toEqual([
      "abort",
      "session",
      "project-append",
      "project-new",
      "global",
    ]);
    const append = opts.find((o) => o.kind === "project-append")!;
    const newOpt = opts.find((o) => o.kind === "project-new")!;
    expect(append.kind === "project-append" && append.targetKey).toBe("/work/foo");
    expect(newOpt.kind === "project-new" && newOpt.targetKey).toBe("/work/foo/sub");
  });

  test("no match: 4 options, project-append targets cwd, hint mentions default seeding", () => {
    const opts = buildPromptOptions({
      situation: { kind: "none", cwd: "/work/orphan" },
      ...PATHS,
    });
    expect(opts.map((o) => o.kind)).toEqual(["abort", "session", "project-append", "global"]);
    const append = opts.find((o) => o.kind === "project-append")!;
    expect(append.kind === "project-append" && append.targetKey).toBe("/work/orphan");
    expect("hint" in append && append.hint).toContain("seeded from default");
  });
});

describe("stepPromptState — hotkeys", () => {
  const situation: ProjectSituation = { kind: "parent", parent: "/work/foo", cwd: "/work/foo/sub" };
  const opts = buildPromptOptions({ situation, ...PATHS });

  test("Escape → abort", () => {
    const action = press(opts, [{ kind: "escape" }]);
    expect(action).toEqual({ kind: "abort" });
  });

  test("lowercase 's' → session immediately (no confirm)", () => {
    const action = press(opts, [{ kind: "char", value: "s" }]);
    expect(action).toEqual({ kind: "session" });
  });

  test("lowercase 'p' → pending; Enter confirms project-append", () => {
    const first = stepPromptState(initPromptState(opts), { kind: "char", value: "p" });
    expect(first.kind).toBe("render");
    if (first.kind === "render") {
      expect(first.state.pendingIndex).not.toBeNull();
      const next = stepPromptState(first.state, { kind: "enter" });
      expect(next.kind).toBe("resolve");
      if (next.kind === "resolve") {
        expect(next.action).toEqual({ kind: "project-append", targetKey: "/work/foo" });
      }
    }
  });

  test("uppercase 'P' → project-append immediately, no confirm step", () => {
    const action = press(opts, [{ kind: "char", value: "P" }]);
    expect(action).toEqual({ kind: "project-append", targetKey: "/work/foo" });
  });

  test("uppercase 'N' → project-new immediately", () => {
    const action = press(opts, [{ kind: "char", value: "N" }]);
    expect(action).toEqual({ kind: "project-new", targetKey: "/work/foo/sub" });
  });

  test("uppercase 'A' → global immediately", () => {
    const action = press(opts, [{ kind: "char", value: "A" }]);
    expect(action).toEqual({ kind: "global" });
  });

  test("arrow navigation + Enter on confirm option puts it pending first", () => {
    // Index 0 is abort (no confirm). Down to project-append (index 2 in parent situation)
    const after1 = stepPromptState(initPromptState(opts), { kind: "down" });
    expect(after1.kind === "render" && after1.state.selectedIndex).toBe(1);
    const after2 = stepPromptState(after1.kind === "render" ? after1.state : initPromptState(opts), { kind: "down" });
    expect(after2.kind === "render" && after2.state.selectedIndex).toBe(2);
    const after3 = stepPromptState(after2.kind === "render" ? after2.state : initPromptState(opts), { kind: "enter" });
    // Enter on selection 2 (project-append) → pending
    expect(after3.kind).toBe("render");
    if (after3.kind === "render") {
      expect(after3.state.pendingIndex).toBe(2);
      const finalStep = stepPromptState(after3.state, { kind: "enter" });
      expect(finalStep.kind).toBe("resolve");
      if (finalStep.kind === "resolve") {
        expect(finalStep.action).toEqual({ kind: "project-append", targetKey: "/work/foo" });
      }
    }
  });

  test("arrow keys clear pending", () => {
    const s1 = stepPromptState(initPromptState(opts), { kind: "char", value: "p" });
    if (s1.kind !== "render") throw new Error("expected render");
    expect(s1.state.pendingIndex).not.toBeNull();
    const s2 = stepPromptState(s1.state, { kind: "down" });
    if (s2.kind !== "render") throw new Error("expected render");
    expect(s2.state.pendingIndex).toBeNull();
  });

  test("Enter on abort (no confirm) resolves immediately", () => {
    // Selected starts at 0 (abort). Enter should not require confirm.
    const action = press(opts, [{ kind: "enter" }]);
    expect(action).toEqual({ kind: "abort" });
  });

  test("unknown character does nothing", () => {
    const s = stepPromptState(initPromptState(opts), { kind: "char", value: "z" });
    expect(s.kind).toBe("render");
    if (s.kind === "render") {
      expect(s.state.selectedIndex).toBe(0);
      expect(s.state.pendingIndex).toBeNull();
    }
  });
});
