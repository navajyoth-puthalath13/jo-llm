import { DurableObject } from "cloudflare:workers";
import type { Env, RateLimitBinding } from "./config";
import { countHit, dayKey, spendBudget, type CounterStore, type HitResult, type Limiter as LimiterApi, type Limits } from "./guard/ratelimit";

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

  /** Deletes expired windows and previous days so storage stays tiny. */
  async alarm() {
    const now = Date.now();
    const today = dayKey(now);
    const stale: string[] = [];
    for (const [key] of await this.ctx.storage.list({ prefix: "w:" })) {
      const window = Number(key.split(":")[1]);
      if (window < Math.floor(now / 1000 / 600) - 1) stale.push(key);
    }
    for (const prefix of ["d:", "g:"]) {
      for (const [key] of await this.ctx.storage.list({ prefix })) {
        if (key.split(":")[1] !== today) stale.push(key);
      }
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
  };
}
