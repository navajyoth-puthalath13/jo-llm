import type { Config, ProviderName } from "../config";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { ProviderBlockedError, ProviderHttpError, type Provider, type ProviderRequest } from "./types";

/** Providers in PROVIDER_ORDER, skipping any without a key. */
export function defaultProviders(config: Config): Provider[] {
  const build: Record<ProviderName, () => Provider | null> = {
    groq: () => (config.groqKey ? groqProvider(config.groqKey, config.groqModel) : null),
    gemini: () => (config.geminiKey ? geminiProvider(config.geminiKey, config.geminiModel) : null),
  };
  return config.providerOrder.map((name) => build[name]()).filter((p): p is Provider => p !== null);
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
  for (let i = 0; i < providers.length; i++) {
    if (signal.aborted) break;
    const provider = providers[i]!;
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
      log(provider.name, err instanceof ProviderHttpError ? `http_${err.status}` : "error");
      ctrl.abort();
    } finally {
      clearTimeout(timer);
    }
  }
  throw new RouteError("busy");
}
