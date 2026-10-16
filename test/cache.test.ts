import { describe, expect, it } from "vitest";
import { cacheKey, chunkAnswer, normalizeQuestion } from "../src/cache";
import { answerText, ask, mockProvider, readEvents, setup } from "./helpers";

describe("answer cache", () => {
  it("normalises questions", () => {
    expect(normalizeQuestion("  How did you get into DESIGN?!  ")).toBe("how did you get into design");
  });

  it("changes key when jo.md changes", async () => {
    expect(await cacheKey("hi", "v1")).not.toBe(await cacheKey("hi", "v2"));
    expect(await cacheKey("Hi!", "v1")).toBe(await cacheKey("hi", "v1"));
  });

  it("serves the second identical question from cache as token events", async () => {
    const provider = mockProvider(["I started ", "as an engineer."]);
    const ctx = setup({ providers: [provider] });
    const first = await readEvents(await ask(ctx, { question: "How did you get into design?" }));
    await new Promise((r) => setTimeout(r, 0));
    const second = await readEvents(await ask(ctx, { question: "how did you get into design" }));
    expect(provider.calls).toHaveLength(1);
    expect(answerText(second)).toBe(answerText(first));
    expect(second.filter((e) => e.event === "token").length).toBeGreaterThan(1);
    expect(second.at(-1)).toEqual({ event: "done", data: { cached: true } });
  });

  it("never caches answers with a quote or history", async () => {
    const provider = mockProvider(["About that passage."]);
    const ctx = setup({ providers: [provider] });
    await (await ask(ctx, { question: "explain this", quote: "some text" })).text();
    await (await ask(ctx, { question: "explain this", quote: "some text" })).text();
    await (await ask(ctx, { question: "and then?", history: [{ q: "a", a: "b" }] })).text();
    expect(provider.calls).toHaveLength(3);
    expect([...ctx.kv.map.keys()].filter((k) => k.startsWith("ans:"))).toHaveLength(0);
  });

  it("chunks answers", () => {
    expect(chunkAnswer("one two three four five")).toEqual(["one two ", "three four ", "five"]);
  });
});
