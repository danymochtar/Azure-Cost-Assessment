import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAccountCookie,
  verifyAccountCookie,
  verifyPassword,
} from "@/lib/users";

const SECRET = "test-secret-at-least-32-chars-long-xxx";

describe("account-record cookies", () => {
  const original = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.BETTER_AUTH_SECRET = original;
  });

  it("round-trips a freshly created account", () => {
    const { value } = createAccountCookie("alice", "hunter2!!");
    const acc = verifyAccountCookie(value);
    expect(acc).not.toBeNull();
    expect(acc?.u).toBe("alice");
    expect(acc?.h).toMatch(/^\$2[aby]\$/); // bcrypt prefix
    expect(verifyPassword(acc!, "hunter2!!")).toBe(true);
    expect(verifyPassword(acc!, "wrong-password")).toBe(false);
  });

  it("rejects an empty / malformed cookie", () => {
    expect(verifyAccountCookie(null)).toBeNull();
    expect(verifyAccountCookie("")).toBeNull();
    expect(verifyAccountCookie("not-a-real-cookie")).toBeNull();
    expect(verifyAccountCookie("a.b.c")).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    const { value } = createAccountCookie("alice", "hunter2!!");
    process.env.BETTER_AUTH_SECRET = "a-totally-different-secret-32xxxxxxxxxx";
    expect(verifyAccountCookie(value)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const { value } = createAccountCookie("alice", "hunter2!!");
    const [payload, sig] = value.split(".");
    const tampered = payload.slice(0, -1) + (payload.slice(-1) === "A" ? "B" : "A");
    expect(verifyAccountCookie(`${tampered}.${sig}`)).toBeNull();
  });

  it("produces a different bcrypt hash each time (salted)", () => {
    const a = createAccountCookie("alice", "hunter2!!");
    const b = createAccountCookie("alice", "hunter2!!");
    expect(a.value).not.toBe(b.value);
  });
});
