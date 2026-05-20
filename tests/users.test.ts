import { beforeEach, describe, expect, it } from "vitest";
import {
  createUser,
  findUser,
  hasPersistentStore,
  userExists,
  verifyPassword,
} from "@/lib/users";

// Clear the in-memory map between tests so they're independent.
function resetMemoryStore() {
  const g = globalThis as unknown as { __azca_users?: Map<string, unknown> };
  g.__azca_users?.clear();
}

describe("user store (in-memory fallback)", () => {
  beforeEach(() => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetMemoryStore();
  });

  it("reports no persistent store when Upstash env is absent", () => {
    expect(hasPersistentStore()).toBe(false);
  });

  it("creates and finds a user", async () => {
    const rec = await createUser("alice@example.com", "hunter2!!");
    expect(rec.identifier).toBe("alice@example.com");
    expect(rec.passwordHash).not.toBe("hunter2!!");

    const found = await findUser("alice@example.com");
    expect(found?.id).toBe(rec.id);
  });

  it("treats identifiers case-insensitively", async () => {
    await createUser("Bob@example.com", "hunter2!!");
    expect(await userExists("bob@example.com")).toBe(true);
    expect(await userExists("BOB@EXAMPLE.COM")).toBe(true);
  });

  it("rejects duplicate registration", async () => {
    await createUser("carol@example.com", "hunter2!!");
    await expect(createUser("carol@example.com", "different!")).rejects.toThrow(
      /already exists/,
    );
  });

  it("verifies the correct password", async () => {
    const rec = await createUser("dave@example.com", "hunter2!!");
    expect(verifyPassword(rec, "hunter2!!")).toBe(true);
    expect(verifyPassword(rec, "wrong-password")).toBe(false);
  });
});
