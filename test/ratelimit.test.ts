import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { hashIp, memoryLimiter } from "../src/guard/ratelimit";
import { ask, errorCode, readEvents, setup } from "./helpers";

const limits = { burst: 15, refillSeconds: 6, daily: 150, globalDailyModelCalls: 2000 };
const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);

describe("rate limiting", () => {
  it("never limits a normal conversation", async () => {
    // 60 questions, one every 10 seconds, is far more than any visitor asks.
    let now = T0;
    const limiter = memoryLimiter(limits, () => now);
    for (let i = 0; i < 60; i++) {
      expect(await limiter.hit("ip")).toBe("ok");
      now += 10_000;
    }
  });

  it("allows a quick burst of 15, then one question every 6 seconds", async () => {
    let now = T0;
    const limiter = memoryLimiter(limits, () => now);
    for (let i = 0; i < 15; i++) expect(await limiter.hit("ip")).toBe("ok");
    expect(await limiter.hit("ip")).toBe("rate_limited");
    now += 3_000;
    expect(await limiter.hit("ip")).toBe("rate_limited");
    now += 3_000; // 6s later: one question back, never a 10-minute lockout
    expect(await limiter.hit("ip")).toBe("ok");
    expect(await limiter.hit("ip")).toBe("rate_limited");
  });

  it("refills completely after a pause", async () => {
    let now = T0;
    const limiter = memoryLimiter(limits, () => now);
    for (let i = 0; i < 15; i++) await limiter.hit("ip");
    now += 15 * 6_000;
    for (let i = 0; i < 15; i++) expect(await limiter.hit("ip")).toBe("ok");
  });

  it("slows a script to one question per refill interval and caps it at 150 a day", async () => {
    let now = T0;
    const limiter = memoryLimiter(limits, () => now);
    let allowed = 0;
    for (let i = 0; i < 3000; i++) {
      if ((await limiter.hit("bot")) === "ok") allowed++;
      now += 1_000; // a request every second for 50 minutes
    }
    expect(allowed).toBe(150);
  });

  it("keeps visitors independent and returns 429 through the API", async () => {
    const ctx = setup({ env: { PER_IP_BURST: "2" } });
    for (let i = 0; i < 2; i++) expect((await ask(ctx, { question: `q ${i}` })).status).toBe(200);
    const res = await ask(ctx, { question: "one more" });
    expect(res.status).toBe(429);
    expect(errorCode(await readEvents(res))).toBe("rate_limited");
    expect((await ask(ctx, { question: "hello" }, { ip: "198.51.100.1" })).status).toBe(200);
  });

  it("returns busy once the global daily budget is spent", async () => {
    const ctx = setup({ env: { DAILY_BUDGET: "2" } });
    for (let i = 0; i < 2; i++) await (await ask(ctx, { question: `q ${i}` }, { ip: `10.0.0.${i}` })).text();
    const res = await ask(ctx, { question: "q 3" }, { ip: "10.0.0.9" });
    expect(errorCode(await readEvents(res))).toBe("busy");
  });

  it("never stores raw IPs", async () => {
    const ctx = setup();
    await (await ask(ctx, { question: "hi" }, { ip: "203.0.113.42" })).text();
    const keys = [...ctx.limiter.store.keys()].join(" ");
    expect(keys).not.toContain("203.0.113.42");
    expect(keys).toContain(await hashIp("203.0.113.42", "test-salt"));
  });

  it("refuses to run without an IP salt", async () => {
    const ctx = setup({ env: { IP_SALT: "" } });
    expect(errorCode(await readEvents(await ask(ctx, { question: "hi" })))).toBe("busy");
  });

  it("hashes are salted", async () => {
    expect(await hashIp("1.2.3.4", "a")).not.toBe(await hashIp("1.2.3.4", "b"));
    expect(loadConfig({} as never).limits).toMatchObject({ burst: 15, refillSeconds: 6, daily: 150 });
  });
});
