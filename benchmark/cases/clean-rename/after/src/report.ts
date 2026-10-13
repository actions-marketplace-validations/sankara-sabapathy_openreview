import { formatNumber, formatPercent } from "./format.js";

export function summaryLine(done: number, total: number): string {
  return `${formatNumber(done)} of ${formatNumber(total)} (${formatPercent(total ? done / total : 0)})`;
}
