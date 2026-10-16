import type { Config, ProviderName } from "../config";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { ProviderBlockedError, ProviderHttpError, type Provider, type ProviderRequest } from "./types";

/** The MODELS chain, skipping any provider without a key. */
export function defaultProviders(config: Config): Provider[] {
  const build: Record<ProviderName, (model: string) => Provider | null> = {
    groq: (model) => (config.groqKey ? groqProvider(config.groqKey, model) : null),
    gemini: (model) => (config.geminiKey ? geminiProvider(config.geminiKey, model) : null),
  };
  return config.models.map((m) => build[m.provider](m.model)).filter((p): p is Provider => p !== null);
}

/** First-word deadline per provider: Groq is fast, Gemini's free tier needs longer. */
export function firstTokenTimeouts(providers: Provider[], config: Config): number[] {
  return providers.map((p) =>
    p.name.startsWith("gemini") ? config.fallbackFirstTokenTimeoutMs : config.firstTokenTimeoutMs,
  );
}

// Models that just said "too many requests" are skipped for a while instead of costing every
// visitor a failed round trip. Per isolate, which is enough: it's an optimisation, not a guard.
const COOLDOWN_MS = 30_000; // without a Retry-After hint; with one, we wait what it says (capped)
const cooledUntil = new Map<string, number>();

export function isCooling(name: string, now = Date.now()): boolean {
  return (cooledUntil.get(name) ?? 0) > now;
}

export function resetCooldowns() {
  cooledUntil.clear();
}

export type RouteFailure = "busy" | "blocked";

export class RouteError extends Error {
  constructor(readonly code: RouteFailure) {
    super(code);
  }
}

export interface OpenedStream {
  provider: string;
  /** The first non-empty chunk, already received. */
  first: string;
  rest: AsyncIterator<string>;
}

const TIMEOUT = Symbol("timeout");

/**
 * Tries providers in order. A provider "wins" once it produces its first chunk within its
 * time-to-first-token budget; after that we are committed to it (no switching mid-answer).
 * Errors, timeouts and empty streams before the first chunk fall through to the next provider.
 * Safety blocks do not fall through: another model shouldn't get a second go at the same input.
 */
export async function openStream(
  providers: Provider[],
  req: ProviderRequest,
  timeoutsMs: number[],
  signal: AbortSignal,
  log: (provider: string, outcome: string) => void = () => {},
): Promise<OpenedStream> {
  // If every model is cooling down, try them all anyway rather than failing without asking.
  const allCooling = providers.every((p) => isCooling(p.name));
  for (let i = 0; i < providers.length; i++) {
    if (signal.aborted) break;
    const provider = providers[i]!;
    if (!allCooling && isCooling(provider.name)) {
      log(provider.name, "skipped_cooling");
      continue;
    }
    const timeoutMs = timeoutsMs[i] ?? timeoutsMs[timeoutsMs.length - 1] ?? 5000;

    const ctrl = new AbortController();
    const onOuterAbort = () => ctrl.abort();
    signal.addEventListener("abort", onOuterAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
    });

    const it = provider.stream(req, ctrl.signal)[Symbol.asyncIterator]();
    try {
      // Skip empty chunks; the clock covers the whole wait for real text.
      const firstText = (async () => {
        while (true) {
          const r = await it.next();
          if (r.done) return null;
          if (r.value) return r.value;
        }
      })();
      const first = await Promise.race([firstText, timeout]);
      if (first === TIMEOUT) {
        log(provider.name, "timeout");
        firstText.catch(() => {});
        ctrl.abort();
        continue;
      }
      if (first === null) {
        log(provider.name, "empty");
        continue;
      }
      return { provider: provider.name, first, rest: it };
    } catch (err) {
      if (err instanceof ProviderBlockedError) {
        ctrl.abort();
        throw new RouteError("blocked");
      }
      if (err instanceof ProviderHttpError && err.status === 429) {
        const wait = err.retryAfterSeconds !== undefined ? Math.min(err.retryAfterSeconds * 1000, COOLDOWN_MS) : COOLDOWN_MS;
        cooledUntil.set(provider.name, Date.now() + wait);
      }
      log(provider.name, err instanceof ProviderHttpError ? `http_${err.status}` : "error");
      ctrl.abort();
    } finally {
      clearTimeout(timer);
    }
  }
  throw new RouteError("busy");
}
