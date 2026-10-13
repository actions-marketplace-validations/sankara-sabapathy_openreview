import { redis, users } from "./store.js";

export type Account = { id: string; email: string; hash: string };

const MAX_FAILURES = 5;

export async function findAccount(email: string): Promise<Account | null> {
  return users.findOne({ email });
}

export async function verifyPassword(a: Account, password: string): Promise<boolean> {
  return users.checkHash(a.hash, password);
}

export async function issueSession(a: Account): Promise<string> {
  return redis.createSession(a.id);
}

export async function isLockedOut(a: Account): Promise<boolean> {
  const failures = Number(await redis.get(`login-failures:${a.id}`)) || 0;
  return failures >= MAX_FAILURES;
}

export async function recordFailure(a: Account): Promise<void> {
  const key = `login-failures:${a.id}`;
  await redis.incr(key);
  await redis.expire(key, 15 * 60);
}
