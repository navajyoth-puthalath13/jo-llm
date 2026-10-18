// Usage tracking for the private usage page (/usage).
//
// Every model call goes through a recording wrapper that notes the provider, whether it worked,
// the tokens the provider billed, and, for rate limits, the provider's own numbers. Events are
// stored in hourly buckets in the limiter Durable Object, so the page can show a rolling 24 hours
// (how Groq counts) and "since midnight UTC" (when Gemini's free-tier day resets: Google's own
// retry times on this key point at 00:00 UTC, although its docs say midnight Pacific).
//
// Only Jo's Worker is seen here. Scripts run from a laptop (npm run eval, npm run ask against
// localhost) use the same API keys but aren't recorded, so the page shows them as a caveat.

import { limitDetail, ProviderHttpError, type JsonRequest, type Provider, type ProviderRequest } from "./providers/types";

export interface UsageEvent {
  provider: string;
  ok: boolean;
  /** Tokens the provider billed, when it reported them. */
  tokens?: number;
  status?: number;
  /** For rate limits: the provider's own numbers ("tokens per day: used … of …"). */
  detail?: string;
  retryAfterSeconds?: number;
}

export interface FreeLimits {
  tokensPerDay?: number;
  requestsPerDay?: number;
  tokensPerMinute?: number;
  requestsPerMinute?: number;
  /** How the daily window works. */
  window: "rolling-24h" | "utc-day";
}

// Published free-tier limits for this account, checked 2026-10-16/18 from the providers' own
// rate-limit responses. Change these if the providers change them.
export const FREE_LIMITS: Record<string, FreeLimits> = {
  "groq:openai/gpt-oss-120b": { tokensPerDay: 200_000, requestsPerDay: 1_000, tokensPerMinute: 8_000, window: "rolling-24h" },
  "groq:openai/gpt-oss-20b": { tokensPerDay: 200_000, requestsPerDay: 1_000, tokensPerMinute: 8_000, window: "rolling-24h" },
  "gemini:gemini-3.6-flash": { requestsPerDay: 20, window: "utc-day" },
  "gemini:gemini-3.5-flash-lite": { requestsPerMinute: 15, window: "utc-day" },
};

/** Wraps providers so every call they make is reported to `sink`. Behaviour is unchanged. */
export function recordingProviders(providers: Provider[], sink: (e: UsageEvent) => void): Provider[] {
  return providers.map((p) => {
    const failed = (err: unknown): UsageEvent =>
      err instanceof ProviderHttpError
        ? { provider: p.name, ok: false, status: err.status, detail: err.detail, retryAfterSeconds: err.retryAfterSeconds }
        : { provider: p.name, ok: false };
    const wrapped: Provider = {
      name: p.name,
      async *stream(req: ProviderRequest, signal: AbortSignal) {
        let tokens: number | undefined;
        let done = false;
        try {
          for await (const chunk of p.stream({ ...req, onUsage: (t) => ((tokens = t), req.onUsage?.(t)) }, signal)) yield chunk;
          done = true;
          sink({ provider: p.name, ok: true, tokens });
        } catch (err) {
          done = true;
          sink(failed(err));
          throw err;
        } finally {
          // The caller stopped early (length cap, decline, timeout): the call still happened.
          if (!done) sink({ provider: p.name, ok: true, tokens });
        }
      },
    };
    if (p.json) {
      wrapped.json = async (req: JsonRequest, signal: AbortSignal) => {
        let tokens: number | undefined;
        try {
          const out = await p.json!({ ...req, onUsage: (t) => ((tokens = t), req.onUsage?.(t)) }, signal);
          sink({ provider: p.name, ok: true, tokens });
          return out;
        } catch (err) {
          sink(failed(err));
          throw err;
        }
      };
    }
    return wrapped;
  });
}

// ── Storage ───────────────────────────────────────────────────────────────────

export interface UsageStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(prefix: string): Promise<Map<string, T>>;
}

interface Bucket {
  requests: number;
  ok: number;
  limited: number;
  tokens: number;
}

export interface LastLimit {
  at: number;
  status: number;
  detail?: string;
  retryAfterSeconds?: number;
}

const HOUR = 60 * 60 * 1000;
export const hourIndex = (now: number) => Math.floor(now / HOUR);

export async function recordUsageEvents(store: UsageStore, events: UsageEvent[], now: number): Promise<void> {
  const h = hourIndex(now);
  const byProvider = new Map<string, UsageEvent[]>();
  for (const e of events) byProvider.set(e.provider, [...(byProvider.get(e.provider) ?? []), e]);
  for (const [provider, list] of byProvider) {
    const key = `u:${h}:${provider}`;
    const b = (await store.get<Bucket>(key)) ?? { requests: 0, ok: 0, limited: 0, tokens: 0 };
    for (const e of list) {
      b.requests += 1;
      if (e.ok) b.ok += 1;
      if (e.status === 429) b.limited += 1;
      b.tokens += e.tokens ?? 0;
    }
    await store.put(key, b);
    const limited = [...list].reverse().find((e) => e.status === 429);
    if (limited) {
      await store.put<LastLimit>(`l:${provider}`, {
        at: now,
        status: 429,
        detail: limited.detail,
        retryAfterSeconds: limited.retryAfterSeconds,
      });
    }
  }
}

/** Hours since midnight UTC (when Gemini's free-tier day resets, by Google's own retry times). */
export function hoursSinceUtcMidnight(now: number): number {
  return new Date(now).getUTCHours();
}

export interface ProviderUsage {
  provider: string;
  last24h: Bucket;
  /** Since midnight UTC (current hour included). */
  today: Bucket;
  lastLimit?: LastLimit;
  limits?: FreeLimits;
}

const empty = (): Bucket => ({ requests: 0, ok: 0, limited: 0, tokens: 0 });
const add = (a: Bucket, b: Bucket) => {
  a.requests += b.requests;
  a.ok += b.ok;
  a.limited += b.limited;
  a.tokens += b.tokens;
};

export async function readProviderUsage(store: UsageStore, now: number, known: string[]): Promise<ProviderUsage[]> {
  const h = hourIndex(now);
  const todayFrom = h - hoursSinceUtcMidnight(now);
  const result = new Map<string, ProviderUsage>();
  const ensure = (provider: string) => {
    if (!result.has(provider)) result.set(provider, { provider, last24h: empty(), today: empty(), limits: FREE_LIMITS[provider] });
    return result.get(provider)!;
  };
  for (const name of known) ensure(name);
  for (const [key, bucket] of await store.list<Bucket>("u:")) {
    const [, hour, ...rest] = key.split(":");
    const provider = rest.join(":");
    const at = Number(hour);
    if (at > h - 24) add(ensure(provider).last24h, bucket);
    if (at >= todayFrom) add(ensure(provider).today, bucket);
  }
  for (const [key, last] of await store.list<LastLimit>("l:")) {
    const provider = key.slice(2);
    if (now - last.at < 48 * HOUR) ensure(provider).lastLimit = last;
  }
  return [...result.values()];
}

/** Keys older than two days can go. */
export function isStaleUsageKey(key: string, now: number): boolean {
  if (!key.startsWith("u:")) return false;
  return Number(key.split(":")[1]) < hourIndex(now) - 48;
}

/** In-memory store for tests and local runs. */
export function memoryUsageStore(): UsageStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async <T,>(k: string) => map.get(k) as T | undefined,
    put: async <T,>(k: string, v: T) => void map.set(k, structuredClone(v)),
    list: async <T,>(prefix: string) =>
      new Map([...map.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, v as T])),
  };
}

// ── Groq probe ("Check Groq now") ─────────────────────────────────────────────

export interface GroqProbe {
  model: string;
  status: number;
  /** Requests left in Groq's daily request window, from its response headers. */
  requestsLeft?: number;
  requestsLimit?: number;
  requestsResetIn?: string;
  /** Tokens left this minute, from its response headers. */
  minuteTokensLeft?: number;
  minuteTokensLimit?: number;
  /** Exact daily-token numbers, when Groq refused because the day is nearly used up. */
  dailyUsed?: number;
  dailyLimit?: number;
  dailyRetryIn?: string;
  /** When Groq accepted the probe: the daily window still had at least this many tokens. */
  dailyAtLeastLeft?: number;
  detail?: string;
}

const PROBE_TOKENS = 6000;

/**
 * Asks Groq for its own numbers with one tiny request ("Reply with OK."). It reserves
 * PROBE_TOKENS, so if fewer than that are left today Groq refuses and its message has the exact
 * daily count. Costs one request and a few dozen tokens; only runs when the button is pressed.
 */
export async function probeGroq(apiKey: string, model: string): Promise<GroqProbe> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: PROBE_TOKENS,
      reasoning_effort: "low",
      reasoning_format: "hidden",
      messages: [{ role: "user", content: "Reply with OK." }],
    }),
  });
  const num = (h: string) => {
    const v = Number(res.headers.get(h));
    return res.headers.has(h) && Number.isFinite(v) ? v : undefined;
  };
  const probe: GroqProbe = {
    model: `groq:${model}`,
    status: res.status,
    requestsLeft: num("x-ratelimit-remaining-requests"),
    requestsLimit: num("x-ratelimit-limit-requests"),
    requestsResetIn: res.headers.get("x-ratelimit-reset-requests") ?? undefined,
    minuteTokensLeft: num("x-ratelimit-remaining-tokens"),
    minuteTokensLimit: num("x-ratelimit-limit-tokens"),
  };
  const body = await res.text();
  if (res.ok) {
    probe.dailyAtLeastLeft = PROBE_TOKENS;
    return probe;
  }
  const m = /tokens per day \(TPD\): Limit (\d+), Used (\d+), Requested \d+\.(?: Please try again in ([\dhms.]+))?/i.exec(body);
  if (m) {
    probe.dailyLimit = Number(m[1]);
    probe.dailyUsed = Number(m[2]);
    probe.dailyRetryIn = m[3]?.replace(/\.+$/, "").replace(/\.\d+s$/, "s");
  }
  probe.detail = limitDetail(body.slice(0, 4000));
  return probe;
}
