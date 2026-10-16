import { findAccount, verifyPassword, issueSession } from "./accounts.js";

export async function login(email: string, password: string) {
  const account = await findAccount(email);
  if (!account) throw new Error("invalid credentials");
  if (!(await verifyPassword(account, password))) throw new Error("invalid credentials");
  return issueSession(account);
}
