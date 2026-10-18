import { DurableObject } from "cloudflare:workers";
import type { Env, RateLimitBinding } from "./config";
import {
  countHit,
  dayKey,
  joStatsFrom,
  spendBudget,
  type CounterStore,
  type HitResult,
  type Limiter as LimiterApi,
  type Limits,
  type UsageStats,
} from "./guard/ratelimit";
import { isStaleUsageKey, readProviderUsage, recordUsageEvents, type UsageEvent, type UsageStore } from "./usage";

const CLEANUP_EVERY_MS = 60 * 60 * 1000;

/**
 * Single global counter store. Durable Object input gates make each method's get→put sequence
 * atomic, so concurrent requests can't both slip under a limit.
 */
export class Limiter extends DurableObject<Env> {
  private store(): CounterStore {
    const s = this.ctx.storage;
    return {
      get: (k) => s.get<number>(k),
      put: (k, v) => s.put(k, v),
    };
  }

  private async ensureAlarm() {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + CLEANUP_EVERY_MS);
    }
  }

  async hit(ipHash: string, limits: Limits): Promise<HitResult> {
    await this.ensureAlarm();
    return countHit(this.store(), ipHash, limits, Date.now());
  }

  async spend(limits: Limits): Promise<boolean> {
    await this.ensureAlarm();
    return spendBudget(this.store(), limits, Date.now());
  }

  private usageStore(): UsageStore {
    const s = this.ctx.storage;
    return {
      get: (k) => s.get(k),
      put: (k, v) => s.put(k, v),
      list: (prefix) => s.list({ prefix }),
    };
  }

  async recordUsage(events: UsageEvent[]): Promise<void> {
    await this.ensureAlarm();
    await recordUsageEvents(this.usageStore(), events, Date.now());
  }

  async stats(knownProviders: string[]): Promise<UsageStats> {
    const now = Date.now();
    const counters = new Map<string, number>();
    for (const prefix of ["g:", "d:"]) {
      for (const [k, v] of await this.ctx.storage.list<number>({ prefix })) counters.set(k, v);
    }
    return { jo: joStatsFrom(counters, now), providers: await readProviderUsage(this.usageStore(), now, knownProviders) };
  }

  /** Deletes idle buckets and previous days so storage stays tiny. */
  async alarm() {
    const now = Date.now();
    const today = dayKey(now);
    const stale: string[] = [];
    // A bucket idle for an hour has refilled completely, which is the same as having no entry.
    for (const [key, at] of await this.ctx.storage.list<number>({ prefix: "b:" })) {
      if (key.endsWith(":at") && now - at > 60 * 60 * 1000) stale.push(key, key.replace(/:at$/, ":t"));
    }
    for (const prefix of ["d:", "g:"]) {
      for (const [key] of await this.ctx.storage.list({ prefix })) {
        if (key.split(":")[1] !== today) stale.push(key);
      }
    }
    for (const [key] of await this.ctx.storage.list({ prefix: "u:" })) {
      if (isStaleUsageKey(key, now)) stale.push(key);
    }
    for (let i = 0; i < stale.length; i += 128) await this.ctx.storage.delete(stale.slice(i, i + 128));
    await this.ctx.storage.setAlarm(now + CLEANUP_EVERY_MS);
  }
}

/** Production limiter: burst filter (Rate Limiting binding) then the Durable Object. */
export function durableLimiter(ns: DurableObjectNamespace<Limiter>, burst: RateLimitBinding | undefined, limits: Limits): LimiterApi {
  const stub = () => ns.get(ns.idFromName("global"));
  return {
    async hit(ipHash) {
      if (burst && !(await burst.limit({ key: ipHash })).success) return "rate_limited";
      return stub().hit(ipHash, limits);
    },
    spend: () => stub().spend(limits),
    recordUsage: (events) => stub().recordUsage(events),
    stats: (known) => stub().stats(known),
  };
}
