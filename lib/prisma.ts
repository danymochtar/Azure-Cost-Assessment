// Prisma client singleton.
//
// Vercel serverless functions reuse instances across invocations when
// containers stay warm, but during development Next.js HMR creates a
// fresh module graph on each save. Without a global pin we'd leak
// connections every reload until the dev server runs out of pool slots.
// Standard Prisma pattern: stash the client on globalThis in dev.

import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __azca_prisma?: PrismaClient };

export const prisma: PrismaClient =
  g.__azca_prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  g.__azca_prisma = prisma;
}

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}
