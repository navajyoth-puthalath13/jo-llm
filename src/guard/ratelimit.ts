// Rate limiting.
//
// Why not KV for counters: KV is eventually consistent and the free plan allows only 1,000 writes
// a day, so KV counters would be both leaky and exhausted by ~300 questions. Counters live in one
// SQLite-backed Durable Object instead (free plan, strongly consistent). The Workers Rate Limiting
// binding sits in front as a cheap burst filter so floods never reach the Durable Object.
//
// Per-person limiting is a token bucket, not a fixed window: a visitor starts with `burst`
// questions and gets one back every `refillSeconds`. A conversation never runs dry; a script
// is slowed to one question per refill interval, and nobody is ever locked out for minutes.

import type { Limits } from "../config";
import { memoryUsageStore, readProviderUsage, recordUsageEvents, type ProviderUsage, type UsageEvent } from "../usage";
export type { Limits };

export type HitResult = "ok" | "rate_limited";

export interface Limiter {
  /** Counts one question from this (hashed) IP. */
  hit(ipHash: string): Promise<HitResult>;
  /** Reserves one model call from the global daily budget. False when the budget is spent. */
  spend(): Promise<boolean>;
  /** Records the model calls one question made (for the private usage page). */
  recordUsage(events: UsageEvent[]): Promise<void>;
  /** Totals for the private usage page. Never includes IP hashes. */
  stats(knownProviders: string[]): Promise<UsageStats>;
}

export interface JoStats {
  /** UTC day the budget and per-person daily counts belong to. */
  day: string;
  budgetUsed: number;
  visitorsToday: number;
  /** Questions from the busiest visitor today (a number only, never who). */
  busiestVisitor: number;
}

export interface UsageStats {
  jo: JoStats;
  providers: ProviderUsage[];
}

/** Today's totals from the counter entries (g:<day> and d:<day>:<ipHash>). */
export function joStatsFrom(entries: Iterable<[string, number]>, now: number): JoStats {
  const day = dayKey(now);
  let budgetUsed = 0;
  let visitorsToday = 0;
  let busiestVisitor = 0;
  for (const [key, value] of entries) {
    if (key === `g:${day}`) budgetUsed = value;
    else if (key.startsWith(`d:${day}:`)) {
      visitorsToday += 1;
      busiestVisitor = Math.max(busiestVisitor, value);
    }
  }
  return { day, budgetUsed, visitorsToday, busiestVisitor };
}

/** Minimal storage surface shared by Durable Object storage and the in-memory test store. */
export interface CounterStore {
  get(key: string): Promise<number | undefined>;
  put(key: string, value: number): Promise<void>;
}

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Token bucket plus daily fairness cap. Consumes only when the request is allowed. */
export async function countHit(store: CounterStore, ipHash: string, limits: Limits, now: number): Promise<HitResult> {
  const tokensKey = `b:${ipHash}:t`;
  const atKey = `b:${ipHash}:at`;
  const dailyKey = `d:${dayKey(now)}:${ipHash}`;
  const [storedTokens, storedAt, d] = await Promise.all([store.get(tokensKey), store.get(atKey), store.get(dailyKey)]);
  const elapsed = Math.max(0, now - (storedAt ?? now)) / 1000;
  const tokens = Math.min(limits.burst, (storedTokens ?? limits.burst) + elapsed / limits.refillSeconds);
  if (tokens < 1 || (d ?? 0) >= limits.daily) return "rate_limited";
  await Promise.all([store.put(tokensKey, tokens - 1), store.put(atKey, now), store.put(dailyKey, (d ?? 0) + 1)]);
  return "ok";
}

export async function spendBudget(store: CounterStore, limits: Limits, now: number): Promise<boolean> {
  const key = `g:${dayKey(now)}`;
  const used = (await store.get(key)) ?? 0;
  if (used >= limits.globalDailyModelCalls) return false;
  await store.put(key, used + 1);
  return true;
}

/** Salted SHA-256 of the IP. The raw IP is never stored or logged. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** In-memory limiter for tests and local experiments. */
export function memoryLimiter(
  limits: Limits | (() => Limits),
  now: () => number = Date.now,
): Limiter & { store: Map<string, number>; usage: ReturnType<typeof memoryUsageStore> } {
  const map = new Map<string, number>();
  const store: CounterStore = {
    get: async (k) => map.get(k),
    put: async (k, v) => void map.set(k, v),
  };
  const usage = memoryUsageStore();
  return {
    store: map,
    usage,
    hit: (ip) => countHit(store, ip, typeof limits === "function" ? limits() : limits, now()),
    spend: () => spendBudget(store, typeof limits === "function" ? limits() : limits, now()),
    recordUsage: (events) => recordUsageEvents(usage, events, now()),
    stats: async (known) => ({ jo: joStatsFrom(map, now()), providers: await readProviderUsage(usage, now(), known) }),
  };
}
