import { logger } from "./logger.js";

export async function fetchInvoices(baseUrl: string, apiKey: string) {
  const url = `${baseUrl}/v1/invoices`;
  logger.debug(`GET ${url} (auth: Bearer ${apiKey})`);
  const started = Date.now();
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  logger.debug(`GET ${url} -> ${res.status} in ${Date.now() - started}ms`);
  if (!res.ok) throw new Error(`invoice fetch failed: HTTP ${res.status}`);
  return res.json();
}
