export function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatPercent(ratio: number): string {
  return `${formatNumber(ratio * 100)}%`;
}
