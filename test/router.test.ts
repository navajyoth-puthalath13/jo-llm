import { describe, expect, it } from "vitest";
import { openStream } from "../src/providers/router";
import { ProviderBlockedError, type Provider } from "../src/providers/types";
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
