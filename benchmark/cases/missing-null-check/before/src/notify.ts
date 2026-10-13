import { users, mailer } from "./services.js";

export async function notifyOwner(ownerId: string, subject: string) {
  const owner = await users.get(ownerId);
  if (!owner) return false;
  await mailer.send(owner.email, subject);
  return true;
}
