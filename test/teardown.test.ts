import { describe, expect, test } from "bun:test";

import { SIGNALS, attachTeardown } from "../src/teardown.ts";

function makeFakeProcess() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const calls: { event: string; arg: unknown }[] = [];
  return {
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return this;
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
      return this;
    },
    emit(event: string, arg?: unknown) {
      for (const l of listeners.get(event) ?? []) l(arg);
    },
    listenerCount(event: string): number {
      return listeners.get(event)?.size ?? 0;
    },
    pid: 12345,
    kill(pid: number, signal: string) {
      calls.push({ event: "kill", arg: { pid, signal } });
      return true as const;
    },
    exit(code?: number) {
      calls.push({ event: "exit", arg: code });
    },
    calls,
  };
}

describe("attachTeardown", () => {
  test("registers handlers for SIGINT/SIGTERM/SIGHUP and beforeExit", () => {
    const fake = makeFakeProcess();
    const handle = attachTeardown({ process: fake as any, teardown: () => {} });
    for (const sig of SIGNALS) {
      expect(fake.listenerCount(sig)).toBe(1);
    }
    expect(fake.listenerCount("beforeExit")).toBe(1);
    handle.detach();
  });

  test("detach removes all handlers", () => {
    const fake = makeFakeProcess();
    const handle = attachTeardown({ process: fake as any, teardown: () => {} });
    handle.detach();
    for (const sig of SIGNALS) expect(fake.listenerCount(sig)).toBe(0);
    expect(fake.listenerCount("beforeExit")).toBe(0);
  });

  test("beforeExit triggers teardown", async () => {
    const fake = makeFakeProcess();
    let calls = 0;
    const handle = attachTeardown({
      process: fake as any,
      teardown: async () => {
        calls++;
      },
    });
    fake.emit("beforeExit");
    // teardown is async; let it resolve
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
    expect(handle.isDone()).toBe(true);
    handle.detach();
  });

  test("SIGINT triggers teardown, detaches, re-raises the same signal", async () => {
    const fake = makeFakeProcess();
    let calls = 0;
    const handle = attachTeardown({
      process: fake as any,
      teardown: async () => {
        calls++;
      },
    });

    fake.emit("SIGINT");
    // Detach must happen synchronously before teardown runs (so re-raising
    // doesn't loop back into our handler).
    expect(fake.listenerCount("SIGINT")).toBe(0);

    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(1);
    expect(fake.calls.some((c) => c.event === "kill" && (c.arg as any).signal === "SIGINT")).toBe(true);
    handle.detach();
  });

  test("teardown is idempotent across multiple emissions", async () => {
    const fake = makeFakeProcess();
    let calls = 0;
    attachTeardown({
      process: fake as any,
      teardown: async () => {
        calls++;
      },
    });
    fake.emit("beforeExit");
    fake.emit("beforeExit");
    fake.emit("beforeExit");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
  });

  test("teardown that throws does not blow up the handler", async () => {
    const fake = makeFakeProcess();
    const handle = attachTeardown({
      process: fake as any,
      teardown: async () => {
        throw new Error("nope");
      },
    });
    fake.emit("beforeExit");
    await new Promise((r) => setTimeout(r, 0));
    // Should have completed despite the throw
    expect(handle.isDone()).toBe(true);
  });
});
