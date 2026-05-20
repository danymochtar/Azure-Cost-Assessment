// User store with two backends:
//   - production: Upstash Redis (Vercel KV) via @upstash/redis
//   - dev / no-Redis: in-memory Map kept on globalThis so HMR doesn't wipe it
//
// Records are keyed `user:{lowercased-identifier}` and serialized as JSON:
//   { id: string, identifier: string, passwordHash: string, createdAt: number }
//
// The identifier is normalised to lowercase so "Admin@x.com" and
// "admin@x.com" collide rather than producing duplicate accounts.

import bcrypt from "bcryptjs";
import { Redis } from "@upstash/redis";

export interface UserRecord {
  id: string;
  identifier: string;
  passwordHash: string;
  createdAt: number;
}

interface UserStore {
  get(identifier: string): Promise<UserRecord | null>;
  create(record: UserRecord): Promise<void>;
  has(identifier: string): Promise<boolean>;
}

function key(identifier: string) {
  return `user:${identifier.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// In-memory dev fallback. Pinned to globalThis so Next.js HMR + module
// re-evaluation don't repeatedly empty the map during a dev session.
// ---------------------------------------------------------------------------
const G = globalThis as unknown as { __azca_users?: Map<string, UserRecord> };
G.__azca_users ??= new Map();
const memMap = G.__azca_users;

const memoryStore: UserStore = {
  async get(identifier) {
    return memMap.get(key(identifier)) ?? null;
  },
  async create(record) {
    memMap.set(key(record.identifier), record);
  },
  async has(identifier) {
    return memMap.has(key(identifier));
  },
};

// ---------------------------------------------------------------------------
// Upstash store
// ---------------------------------------------------------------------------
function makeUpstashStore(): UserStore | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  return {
    async get(identifier) {
      const raw = await redis.get<UserRecord | string>(key(identifier));
      if (!raw) return null;
      // @upstash/redis auto-parses JSON when stored via .set with object,
      // but returns the raw string when stored as a string. Cover both.
      if (typeof raw === "string") {
        try { return JSON.parse(raw) as UserRecord; } catch { return null; }
      }
      return raw;
    },
    async create(record) {
      // NX: refuse to overwrite if the key already exists.
      const ok = await redis.set(key(record.identifier), record, { nx: true });
      if (ok === null) throw new Error("User already exists");
    },
    async has(identifier) {
      return (await redis.exists(key(identifier))) === 1;
    },
  };
}

// Lazy singleton so the first call decides which backend to use.
let storeImpl: UserStore | null = null;
function store(): UserStore {
  if (storeImpl) return storeImpl;
  storeImpl = makeUpstashStore() ?? memoryStore;
  return storeImpl;
}

export function hasPersistentStore(): boolean {
  return makeUpstashStore() !== null;
}

// Public API ------------------------------------------------------------------

export async function findUser(identifier: string): Promise<UserRecord | null> {
  return store().get(identifier);
}

export async function userExists(identifier: string): Promise<boolean> {
  return store().has(identifier);
}

export async function createUser(identifier: string, password: string): Promise<UserRecord> {
  const trimmed = identifier.trim();
  if (await store().has(trimmed)) {
    throw new Error("User already exists");
  }
  const record: UserRecord = {
    id: crypto.randomUUID(),
    identifier: trimmed,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: Date.now(),
  };
  await store().create(record);
  return record;
}

export function verifyPassword(record: UserRecord, password: string): boolean {
  return bcrypt.compareSync(password, record.passwordHash);
}
