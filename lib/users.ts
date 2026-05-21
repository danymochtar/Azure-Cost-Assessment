// User store backed by Postgres via Prisma.
//
// Usernames are stored case-insensitively (we lowercase on the way in
// and lookup is by exact match). Passwords are bcrypt-hashed (10 rounds).
// The bootstrap admin (APP_USER / APP_PASSWORD env vars) lives outside
// this store and is checked separately in /api/auth/login — that path
// always works, even when DATABASE_URL is unset, so the deployment
// has at least one usable login regardless of DB health.

import bcrypt from "bcryptjs";
import { prisma, hasDatabase } from "./prisma";

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

function normaliseUsername(s: string): string {
  return s.trim().toLowerCase();
}

export { normaliseUsername };

export async function findUser(usernameRaw: string): Promise<UserRecord | null> {
  if (!hasDatabase()) return null;
  const username = normaliseUsername(usernameRaw);
  if (!username) return null;
  return prisma.user.findUnique({ where: { username } });
}

export async function userExists(usernameRaw: string): Promise<boolean> {
  if (!hasDatabase()) return false;
  const username = normaliseUsername(usernameRaw);
  if (!username) return false;
  const count = await prisma.user.count({ where: { username } });
  return count > 0;
}

export async function createUser(usernameRaw: string, password: string): Promise<UserRecord> {
  if (!hasDatabase()) {
    throw new Error("Registration unavailable: DATABASE_URL is not configured.");
  }
  const username = normaliseUsername(usernameRaw);
  if (!username) throw new Error("Username can't be blank.");

  // Pre-check so we return a clean 409 rather than a Prisma unique-violation.
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new Error("An account with that username already exists.");

  const passwordHash = bcrypt.hashSync(password, 10);
  return prisma.user.create({
    data: { username, passwordHash },
  });
}

export function verifyPassword(record: UserRecord, password: string): boolean {
  try {
    return bcrypt.compareSync(password, record.passwordHash);
  } catch {
    return false;
  }
}

export async function updatePassword(usernameRaw: string, newPassword: string): Promise<boolean> {
  if (!hasDatabase()) {
    throw new Error("Password reset unavailable: DATABASE_URL is not configured.");
  }
  const username = normaliseUsername(usernameRaw);
  if (!username) return false;
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  try {
    await prisma.user.update({
      where: { username },
      data: { passwordHash },
    });
    return true;
  } catch {
    // Prisma throws P2025 when no row matches. Surface as "no such user".
    return false;
  }
}

export async function changePassword(
  usernameRaw: string,
  oldPassword: string,
  newPassword: string,
): Promise<"ok" | "wrong-password" | "no-user"> {
  if (!hasDatabase()) {
    throw new Error("Password change unavailable: DATABASE_URL is not configured.");
  }
  const user = await findUser(usernameRaw);
  if (!user) return "no-user";
  if (!verifyPassword(user, oldPassword)) return "wrong-password";
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  return "ok";
}
