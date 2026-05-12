import { describe, expect, test } from "bun:test";

import { extractBlockedWritePath } from "../src/output.ts";

describe("extractBlockedWritePath", () => {
  test("/bin/bash line N variant", () => {
    expect(
      extractBlockedWritePath("/bin/bash: line 1: /etc/foo: Operation not permitted"),
    ).toBe("/etc/foo");
  });
  test("bash without line number", () => {
    expect(extractBlockedWritePath("bash: /etc/foo: Operation not permitted")).toBe("/etc/foo");
  });
  test("sh: line N variant", () => {
    expect(extractBlockedWritePath("sh: line 12: /tmp/x.txt: Operation not permitted")).toBe(
      "/tmp/x.txt",
    );
  });
  test("returns null when no match", () => {
    expect(extractBlockedWritePath("no such error here")).toBeNull();
    expect(extractBlockedWritePath("")).toBeNull();
  });
  test("returns null for partial substring matches", () => {
    // "Operation not permitted" in a different format should not match
    expect(extractBlockedWritePath("kernel: Operation not permitted")).toBeNull();
  });
  test("first match wins in multi-line output", () => {
    const output =
      "some preamble\nbash: /first: Operation not permitted\nbash: /second: Operation not permitted";
    expect(extractBlockedWritePath(output)).toBe("/first");
  });
});
