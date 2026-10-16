import { redis, users } from "./store.js";

export type Account = { id: string; email: string; hash: string };

export async function findAccount(email: string): Promise<Account | null> {
  return users.findOne({ email });
}

export async function verifyPassword(a: Account, password: string): Promise<boolean> {
  return users.checkHash(a.hash, password);
}

export async function issueSession(a: Account): Promise<string> {
  return redis.createSession(a.id);
}
