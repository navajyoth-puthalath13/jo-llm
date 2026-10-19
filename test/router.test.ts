import { describe, expect, it } from "vitest";
import { openStream, resetCooldowns } from "../src/providers/router";
import { ProviderBlockedError, ProviderHttpError, type Provider } from "../src/providers/types";
import { answerText, ask, errorCode, mockProvider, readEvents, setup } from "./helpers";

const req = { system: "s", user: "u", maxTokens: 10 };

describe("provider router", () => {
  it("falls back when the primary misses its first-token deadline", async () => {
    const slow = mockProvider(["slow"], { name: "primary", delayMs: 500 });
    const fast = mockProvider(["fast ", "answer"], { name: "fallback" });
    const opened = await openStream([slow, fast], req, [50, 1000], new AbortController().signal);
    expect(opened.provider).toBe("fallback");
    expect(opened.first).toBe("fast ");
  });

  it("falls back when the primary errors", async () => {
    const down = mockProvider([], { name: "primary", fail: true });
    const ok = mockProvider(["hi"], { name: "fallback" });
    expect((await openStream([down, ok], req, [1000, 1000], new AbortController().signal)).provider).toBe("fallback");
  });

  it("does not fall back on a safety block", async () => {
    const blocked: Provider = {
      name: "primary",
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new ProviderBlockedError();
      },
    };
    const fallback = mockProvider(["x"], { name: "fallback" });
    await expect(openStream([blocked, fallback], req, [1000, 1000], new AbortController().signal)).rejects.toThrow("blocked");
    expect(fallback.calls).toHaveLength(0);
  });

  it("returns busy to the client when every provider fails", async () => {
    const ctx = setup({ providers: [mockProvider([], { fail: true }), mockProvider([], { fail: true })] });
    expect(errorCode(await readEvents(await ask(ctx, { question: "hi" })))).toBe("busy");
  });

  it("uses the fallback end to end when the primary is slow", async () => {
    const ctx = setup({
      providers: [mockProvider(["slow"], { delayMs: 4000 }), mockProvider(["From ", "the ", "fallback."])],
    });
    const events = await readEvents(await ask(ctx, { question: "hi" }));
    expect(answerText(events)).toBe("From the fallback.");
  }, 10000);
});

describe("model chain", () => {
  it("answers with Groq 120b, then Gemini, then Groq 20b as a last resort; routes and picks buttons with Groq 20b", async () => {
    const { loadConfig } = await import("../src/config");
    const { defaultProviders, utilityProviders } = await import("../src/providers/router");
    const keys = { GEMINI_API_KEY: "g", GROQ_API_KEY: "q" };
    expect(defaultProviders(loadConfig({ ...keys } as never)).map((p) => p.name)).toEqual([
      "groq:openai/gpt-oss-120b",
      "gemini:gemini-3.6-flash",
      "groq:openai/gpt-oss-20b",
    ]);
    expect(utilityProviders(loadConfig({ ...keys } as never)).map((p) => p.name)).toEqual([
      "groq:openai/gpt-oss-20b",
      "gemini:gemini-3.5-flash-lite",
    ]);
    expect(
      defaultProviders(loadConfig({ ...keys, MODELS: "gemini:gemini-3.6-flash, groq:openai/gpt-oss-20b" } as never)).map((p) => p.name),
    ).toEqual(["gemini:gemini-3.6-flash", "groq:openai/gpt-oss-20b"]);
    // Providers without a key are skipped; nonsense falls back to the defaults.
    expect(defaultProviders(loadConfig({ GEMINI_API_KEY: "g" } as never)).every((p) => p.name.startsWith("gemini:"))).toBe(true);
    expect(loadConfig({ MODELS: "nonsense,openai:gpt" } as never).models).toHaveLength(3);
    expect(loadConfig({} as never).answerReasoning).toBe("medium");
  });

  it("gives Groq the short first-word deadline and Gemini the long one", async () => {
    const { loadConfig } = await import("../src/config");
    const { defaultProviders, firstTokenTimeouts } = await import("../src/providers/router");
    const config = loadConfig({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" } as never);
    expect(firstTokenTimeouts(defaultProviders(config), config)).toEqual([2500, 10000, 2500]);
  });
});

describe("429 cooldown", () => {
  it("skips a model for a while after it says too many requests", async () => {
    const { ProviderHttpError } = await import("../src/providers/types");
    const { resetCooldowns } = await import("../src/providers/router");
    resetCooldowns();
    const limited: Provider & { calls: number } = {
      name: "limited",
      calls: 0,
      // eslint-disable-next-line require-yield
      async *stream() {
        this.calls++;
        throw new ProviderHttpError(429);
      },
    };
    const backup = mockProvider(["ok"], { name: "backup" });
    const outcomes: string[] = [];
    const log = (name: string, result: string) => outcomes.push(`${name}:${result}`);
    await openStream([limited, backup], req, [1000, 1000], new AbortController().signal, log);
    await openStream([limited, backup], req, [1000, 1000], new AbortController().signal, log);
    expect(limited.calls).toBe(1);
    expect(outcomes).toEqual(["limited:http_429", "limited:skipped_cooling"]);
    resetCooldowns();
  });

  it("waits out a short per-minute limit once instead of saying busy", async () => {
    resetCooldowns();
    const flaky = (name: string, detail: string, failures: number): Provider & { calls: number } => ({
      name,
      calls: 0,
      async *stream() {
        this.calls++;
        if (this.calls <= failures) throw new ProviderHttpError(429, undefined, detail);
        yield "answer";
      },
    });
    const daily = flaky("daily", "tokens per day: used 199,000 of 200,000, needed 3,000; retry in 9m0s", 99);
    const minute = flaky("minute", "tokens per minute: used 6,353 of 8,000, needed 4,243; retry in 0.05s", 1);
    const outcomes: string[] = [];
    const opened = await openStream([daily, minute], req, [1000, 1000], new AbortController().signal, (n, r) => outcomes.push(`${n}:${r}`));
    expect(opened.provider).toBe("minute");
    expect(daily.calls).toBe(1); // a daily limit is never retried
    expect(minute.calls).toBe(2);
    expect(outcomes).toContain("minute:waiting_1s_for_minute_limit");
    resetCooldowns();
  });

  it("doesn't wait for a daily limit, a long wait, or a second time", async () => {
    resetCooldowns();
    const always = (name: string, detail: string): Provider => ({
      name,
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new ProviderHttpError(429, undefined, detail);
      },
    });
    const started = Date.now();
    await expect(openStream([always("d", "tokens per day: used 1 of 2; retry in 3s")], req, [1000], new AbortController().signal)).rejects.toThrow(
      "busy",
    );
    await expect(openStream([always("l", "tokens per minute: used 1 of 2; retry in 45s")], req, [1000], new AbortController().signal)).rejects.toThrow(
      "busy",
    );
    expect(Date.now() - started).toBeLessThan(500);
    // A per-minute limit that's still there after the wait: busy, no endless loop.
    await expect(
      openStream([always("m", "tokens per minute: used 1 of 2; retry in 0.05s")], req, [1000], new AbortController().signal),
    ).rejects.toThrow("busy");
    resetCooldowns();
  });
});

describe("Retry-After", () => {
  it("skips a 429'd model only as long as the provider asked", async () => {
    const { ProviderHttpError } = await import("../src/providers/types");
    const { isCooling, resetCooldowns } = await import("../src/providers/router");
    resetCooldowns();
    const limited: Provider = {
      name: "brief",
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new ProviderHttpError(429, 2);
      },
    };
    await openStream([limited, mockProvider(["ok"])], req, [1000, 1000], new AbortController().signal);
    expect(isCooling("brief", Date.now() + 1_000)).toBe(true);
    expect(isCooling("brief", Date.now() + 2_500)).toBe(false);
    // Test mode: no skipping, every model is asked.
    const { setCooldowns } = await import("../src/providers/router");
    setCooldowns(false);
    expect(isCooling("brief", Date.now() + 1_000)).toBe(false);
    setCooldowns(true);
    resetCooldowns();
  });
});
