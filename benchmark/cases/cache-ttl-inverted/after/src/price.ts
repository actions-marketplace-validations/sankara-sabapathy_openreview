import { rates } from "./rates.js";

const cache = new Map<string, { rate: number; at: number }>();
const TTL_MS = 60_000;

async function cachedRate(from: string, to: string): Promise<number> {
  const key = `${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at > TTL_MS) return hit.rate;
  const rate = await rates.lookup(from, to);
  cache.set(key, { rate, at: Date.now() });
  return rate;
}

export async function convert(amount: number, from: string, to: string): Promise<number> {
  const rate = await cachedRate(from.toUpperCase(), to.toUpperCase());
  return Math.round(amount * rate * 100) / 100;
}
