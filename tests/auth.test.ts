import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  constantTimeEqualStr,
  createSessionCookie,
  verifySessionCookie,
} from "@/lib/auth";

const SECRET = "test-secret-at-least-32-chars-long-xxx";

describe("session cookies", () => {
  const original = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.BETTER_AUTH_SECRET = original;
  });

  it("round-trips a valid session", () => {
    const { value } = createSessionCookie("admin");
    const payload = verifySessionCookie(value);
    expect(payload).not.toBeNull();
    expect(payload?.u).toBe("admin");
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects an empty cookie", () => {
    expect(verifySessionCookie(null)).toBeNull();
    expect(verifySessionCookie("")).toBeNull();
    expect(verifySessionCookie(undefined)).toBeNull();
  });

  it("rejects a malformed cookie", () => {
    expect(verifySessionCookie("not-a-real-cookie")).toBeNull();
    expect(verifySessionCookie("a.b.c")).toBeNull();
    expect(verifySessionCookie("payload-only")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const { value } = createSessionCookie("admin");
    const [payload, sig] = value.split(".");
    // Flip a byte in the base64 payload
    const tampered = payload.slice(0, -1) + (payload.slice(-1) === "A" ? "B" : "A");
    expect(verifySessionCookie(`${tampered}.${sig}`)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    const { value } = createSessionCookie("admin");
    process.env.BETTER_AUTH_SECRET = "a-totally-different-secret-32xxxxxxxxxx";
    expect(verifySessionCookie(value)).toBeNull();
  });

  it("rejects when BETTER_AUTH_SECRET is missing on verify", () => {
    const { value } = createSessionCookie("admin");
    delete process.env.BETTER_AUTH_SECRET;
    expect(verifySessionCookie(value)).toBeNull();
  });

  it("throws when BETTER_AUTH_SECRET is missing on sign", () => {
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => createSessionCookie("admin")).toThrow(/BETTER_AUTH_SECRET/);
  });
});

describe("constantTimeEqualStr", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeEqualStr("admin", "admin")).toBe(true);
  });
  it("returns false for different strings of same length", () => {
    expect(constantTimeEqualStr("admin", "adm1n")).toBe(false);
  });
  it("returns false for strings of different lengths (no length leak)", () => {
    expect(constantTimeEqualStr("admin", "administrator")).toBe(false);
  });
});
