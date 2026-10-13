import { rates } from "./rates.js";

export async function convert(amount: number, from: string, to: string): Promise<number> {
  const rate = await rates.lookup(from, to);
  return Math.round(amount * rate * 100) / 100;
}
