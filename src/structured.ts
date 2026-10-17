// Small structured calls (router, button picker). The model must return JSON that matches a
// schema; the result is validated again with Zod, and every id is checked by the caller.
// One time budget covers the whole provider chain. Any failure returns null so the caller can
// fall back to deterministic rules.

import type { z } from "zod";
import { isCooling, noteRateLimited } from "./providers/router";
import { ProviderHttpError, type JsonRequest, type Provider } from "./providers/types";

export interface StructuredResult<T> {
  value: T;
  provider: string;
}

export async function structuredCall<T>(
  providers: Provider[],
  req: JsonRequest,
  validator: z.ZodType<T>,
  budgetMs: number,
  signal: AbortSignal,
  log: (provider: string, outcome: string) => void = () => {},
): Promise<StructuredResult<T> | null> {
  const deadline = Date.now() + budgetMs;
  for (const provider of providers) {
    if (!provider.json || signal.aborted) continue;
    if (isCooling(provider.name)) {
      log(provider.name, "skipped_cooling");
      continue;
    }
    const remaining = deadline - Date.now();
    if (remaining < 50) break;
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, remaining);
    try {
      const raw = await provider.json(req, ctrl.signal);
      const parsed = validator.safeParse(JSON.parse(raw));
      if (parsed.success) return { value: parsed.data, provider: provider.name };
      log(provider.name, "invalid_json");
    } catch (err) {
      if (err instanceof ProviderHttpError && err.status === 429) noteRateLimited(provider.name, err.retryAfterSeconds);
      log(provider.name, ctrl.signal.aborted && !signal.aborted ? "timeout" : err instanceof ProviderHttpError ? `http_${err.status}` : "error");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  return null;
}
