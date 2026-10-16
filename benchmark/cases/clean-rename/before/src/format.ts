export function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtPct(ratio: number): string {
  return `${fmt(ratio * 100)}%`;
}
