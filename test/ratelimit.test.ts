import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { hashIp, memoryLimiter } from "../src/guard/ratelimit";
import { ask, errorCode, readEvents, setup } from "./helpers";

const limits = { perIpWindow: 8, perIpWindowSeconds: 600, perIpDaily: 30, globalDailyModelCalls: 1000 };

describe("rate limiting", () => {
  it("allows 8 questions per 10 minutes per IP, then limits", async () => {
    const ctx = setup();
    for (let i = 0; i < 8; i++) {
      const res = await ask(ctx, { question: `question ${i}` });
      expect(res.status).toBe(200);
      await res.text();
    }
    const res = await ask(ctx, { question: "one more" });
    expect(res.status).toBe(429);
    expect(errorCode(await readEvents(res))).toBe("rate_limited");

    // A different IP is unaffected.
    const other = await ask(ctx, { question: "hello" }, { ip: "198.51.100.1" });
    expect(other.status).toBe(200);
  });

  it("resets the window after 10 minutes but enforces 30 per day", async () => {
    let now = Date.UTC(2026, 9, 16, 0, 0, 0);
    const limiter = memoryLimiter(limits, () => now);
    let allowed = 0;
    for (let i = 0; i < 60; i++) {
      if ((await limiter.hit("ip")) === "ok") allowed++;
      now += 2 * 60 * 1000; // every 2 minutes
    }
    expect(allowed).toBe(30);
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
    expect(loadConfig({} as never).limits.perIpWindow).toBe(8);
  });
});
