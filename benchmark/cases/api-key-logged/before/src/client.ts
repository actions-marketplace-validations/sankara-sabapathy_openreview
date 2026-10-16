import { logger } from "./logger.js";

export async function fetchInvoices(baseUrl: string, apiKey: string) {
  const res = await fetch(`${baseUrl}/v1/invoices`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`invoice fetch failed: HTTP ${res.status}`);
  return res.json();
}
