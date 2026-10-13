import { findAccount, verifyPassword, issueSession, isLockedOut, recordFailure } from "./accounts.js";

export async function login(email: string, password: string) {
  const account = await findAccount(email);
  if (!account) throw new Error("invalid credentials");
  if (isLockedOut(account)) {
    throw new Error("account temporarily locked, try again later");
  }
  if (!(await verifyPassword(account, password))) {
    await recordFailure(account);
    throw new Error("invalid credentials");
  }
  return issueSession(account);
}
