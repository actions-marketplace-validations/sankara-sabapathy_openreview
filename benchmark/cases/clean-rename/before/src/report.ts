import { fmt, fmtPct } from "./format.js";

export function summaryLine(done: number, total: number): string {
  return `${fmt(done)} of ${fmt(total)} (${fmtPct(total ? done / total : 0)})`;
}
