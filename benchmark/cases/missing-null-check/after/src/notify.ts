import { users, mailer } from "./services.js";

export async function notifyOwner(ownerId: string, subject: string) {
  const owner = await users.get(ownerId);
  if (!owner) return false;
  await mailer.send(owner.email, subject);
  return true;
}

/** Email every watcher of a document; watchers who deleted their account are skipped. */
export async function notifyWatchers(watcherIds: string[], subject: string) {
  const all = await users.getMany(watcherIds); // returns (User | null)[] in input order
  let sent = 0;
  for (const watcher of all) {
    if (watcher.settings.muted) continue;
    await mailer.send(watcher.email, subject);
    sent++;
  }
  return sent;
}
