import { describe, expect, it } from "vitest";
import { hashIp } from "../src/guard/ratelimit";
import { limitDetail, ProviderHttpError, type Provider } from "../src/providers/types";
import {
  hoursSinceUtcMidnight,
  memoryUsageStore,
  readProviderUsage,
  recordingProviders,
  recordUsageEvents,
  type UsageEvent,
} from "../src/usage";
import { ask, mockProvider, setup } from "./helpers";

const TOKEN = "s3cret-admin-token";
const data = (ctx: ReturnType<typeof setup>, headers: Record<string, string> = {}, query = "") =>
  ctx.app.request(`/usage/data${query}`, { headers }, ctx.env);

describe("usage page access", () => {
  it("is switched off without ADMIN_TOKEN", async () => {
    const ctx = setup();
    for (const path of ["/usage", "/usage/app.js", "/usage/app.css", "/usage/data"]) {
      expect((await ctx.app.request(path, {}, ctx.env)).status, path).toBe(404);
    }
  });

  it("serves the page shell with a strict CSP and no data in it", async () => {
    const ctx = setup({ env: { ADMIN_TOKEN: TOKEN } });
    const res = await ctx.app.request("/usage", {}, ctx.env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    const html = await res.text();
    expect(html).not.toContain(TOKEN);
    expect(html).toContain("/usage/app.js");
  });

  it("refuses data without the right token", async () => {
    const ctx = setup({ env: { ADMIN_TOKEN: TOKEN } });
    expect((await data(ctx)).status).toBe(401);
    expect((await data(ctx, { Authorization: "Bearer nope" })).status).toBe(401);
    expect((await data(ctx, { Authorization: `Bearer ${TOKEN}x` })).status).toBe(401);
    expect((await data(ctx, { Authorization: TOKEN })).status).toBe(401);
  });

  it("allows its own origin and still blocks others", async () => {
    const ctx = setup({ env: { ADMIN_TOKEN: TOKEN } });
    const auth = { Authorization: `Bearer ${TOKEN}` };
    expect((await data(ctx, { ...auth, Origin: "http://localhost" })).status).toBe(200);
    expect((await data(ctx, { ...auth, Origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("usage data", () => {
  it("reports Jo's limits, today's budget and visitors, and never IP hashes", async () => {
    const ctx = setup({ env: { ADMIN_TOKEN: TOKEN } });
    // Three different questions (an identical one would come from the cache and not count).
    const visits: [string, string][] = [["198.51.100.1", "first"], ["198.51.100.2", "second"], ["198.51.100.2", "third"]];
    for (const [ip, q] of visits) await (await ask(ctx, { question: `${q} question` }, { ip })).text();
    const res = await data(ctx, { Authorization: `Bearer ${TOKEN}` });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as {
      jo: { enabled: boolean; testMode: boolean; limits: { burst: number }; models: string[] };
      stats: { jo: { budgetUsed: number; visitorsToday: number; busiestVisitor: number }; providers: { provider: string }[] };
      resets: { utcMidnightInMs: number };
    };
    expect(body.jo.enabled).toBe(true);
    expect(body.jo.testMode).toBe(false);
    expect(body.jo.models[0]).toBe("groq:openai/gpt-oss-120b");
    expect(body.stats.jo).toMatchObject({ budgetUsed: 3, visitorsToday: 2, busiestVisitor: 2 });
    expect(body.stats.providers.map((p) => p.provider)).toContain("gemini:gemini-3.6-flash");
    expect(body.resets.utcMidnightInMs).toBeGreaterThan(0);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(await hashIp("198.51.100.1", "test-salt"));
    expect(raw).not.toContain("198.51.100");
  });

  it("flags test mode", async () => {
    const ctx = setup({ env: { ADMIN_TOKEN: TOKEN, PER_IP_BURST: "100000", DAILY_BUDGET: "100000" } });
    const body = (await (await data(ctx, { Authorization: `Bearer ${TOKEN}` })).json()) as { jo: { testMode: boolean } };
    expect(body.jo.testMode).toBe(true);
  });

  it("records the model calls each question makes", async () => {
    const ctx = setup({ env: { ADMIN_TOKEN: TOKEN }, providers: [mockProvider(["Hello there."], { name: "mock-answer" })] });
    await (await ask(ctx, { question: "Tell me about CARE Scribe" })).text();
    await new Promise((r) => setTimeout(r, 0));
    const providers = (await ctx.limiter.stats(["mock-answer"])).providers;
    expect(providers.find((p) => p.provider === "mock-answer")?.last24h.requests).toBe(1);
  });
});

describe("recording providers", () => {
  it("records success with tokens, and rate limits with the provider's numbers", async () => {
    const events: UsageEvent[] = [];
    const ok: Provider = {
      name: "ok",
      async *stream(req) {
        req.onUsage?.(1234);
        yield "hi";
      },
    };
    const limited: Provider = {
      name: "limited",
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new ProviderHttpError(429, 30, "tokens per day: used 197,695 of 200,000, needed 2,659");
      },
    };
    const [a, b] = recordingProviders([ok, limited], (e) => events.push(e));
    for await (const _ of a!.stream({ system: "s", user: "u", maxTokens: 10 }, new AbortController().signal)) void _;
    await expect(
      (async () => {
        for await (const _ of b!.stream({ system: "s", user: "u", maxTokens: 10 }, new AbortController().signal)) void _;
      })(),
    ).rejects.toThrow();
    expect(events).toEqual([
      { provider: "ok", ok: true, tokens: 1234 },
      { provider: "limited", ok: false, status: 429, detail: "tokens per day: used 197,695 of 200,000, needed 2,659", retryAfterSeconds: 30 },
    ]);
  });

  it("records a call that the caller stopped early", async () => {
    const events: UsageEvent[] = [];
    const chatty: Provider = {
      name: "chatty",
      async *stream() {
        yield "one";
        yield "two";
      },
    };
    const [w] = recordingProviders([chatty], (e) => events.push(e));
    for await (const _ of w!.stream({ system: "s", user: "u", maxTokens: 10 }, new AbortController().signal)) break;
    expect(events).toEqual([{ provider: "chatty", ok: true, tokens: undefined }]);
  });
});

describe("usage windows", () => {
  it("sums the last 24 hours and the UTC day separately", async () => {
    const store = memoryUsageStore();
    const now = Date.UTC(2026, 9, 18, 5, 0, 0); // 05:00 UTC
    const H = 3_600_000;
    await recordUsageEvents(store, [{ provider: "g", ok: true, tokens: 100 }], now - 30 * H); // too old
    await recordUsageEvents(store, [{ provider: "g", ok: true, tokens: 200 }], now - 10 * H); // last 24h, previous UTC day
    await recordUsageEvents(store, [{ provider: "g", ok: true, tokens: 300 }, { provider: "g", ok: false, status: 429, detail: "x" }], now);
    const [g] = await readProviderUsage(store, now, []);
    expect(hoursSinceUtcMidnight(now)).toBe(5);
    expect(g!.last24h).toEqual({ requests: 3, ok: 2, limited: 1, tokens: 500 });
    expect(g!.today).toEqual({ requests: 2, ok: 1, limited: 1, tokens: 300 });
    expect(g!.lastLimit).toMatchObject({ status: 429, detail: "x" });
  });
});

describe("limit messages", () => {
  it("keeps only the numbers from Groq and Gemini rate-limit messages", () => {
    expect(
      limitDetail(
        "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01abc` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197695, Requested 2659. Please try again in 2m32.928s. Need more tokens?",
      ),
    ).toBe("tokens per day: used 197,695 of 200,000, needed 2,659; retry in 2m32s");
    expect(
      limitDetail(
        "You exceeded your current quota. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash\nPlease retry in 14h40m50.4s.",
      ),
    ).toBe("requests per day: limit 20; resets in 14h40m50s");
    expect(limitDetail("something else")).toBeUndefined();
  });
});

describe("page script", () => {
  it("parses, and its patterns survive the template string", async () => {
    const { USAGE_JS } = await import("../src/usage-page");
    expect(() => new Function(USAGE_JS)).not.toThrow();
    // A single backslash inside the template literal would be lost ("\d" → "d").
    expect(USAGE_JS).toContain("used ([\\d,]+) of");
    expect(USAGE_JS).not.toContain("innerHTML");
  });
});

describe("page countdowns", () => {
  it("keeps the wait-time patterns intact in the served script", async () => {
    const { USAGE_JS } = await import("../src/usage-page");
    // Run the page's own parser: build it from the served source.
    const src = /const parseWait = \(s\) => \{[\s\S]*?\n  \};/.exec(USAGE_JS)![0];
    const parseWait = new Function(`${src}; return parseWait;`)() as (s: string) => number | null;
    expect(parseWait("7m46s")).toBe(466_000);
    expect(parseWait("14h18m53s")).toBe((14 * 3600 + 18 * 60 + 53) * 1000);
    expect(parseWait("51.84s")).toBe(51_840);
    expect(parseWait("nonsense")).toBeNull();
    expect(USAGE_JS).toContain("retry in ([\\dhms.]+)");
  });
});
