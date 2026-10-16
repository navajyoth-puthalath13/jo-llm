import { describe, expect, it } from "vitest";
import { ask, errorCode, mockProvider, readEvents, setup } from "./helpers";

describe("kill switch", () => {
  it("returns offline without calling the provider when KV says false", async () => {
    const provider = mockProvider(["hi"]);
    const ctx = setup({ providers: [provider], kv: { "jo:enabled": "false" } });
    const res = await ask(ctx, { question: "hi" });
    expect(res.status).toBe(503);
    expect(errorCode(await readEvents(res))).toBe("offline");
    expect(provider.calls).toHaveLength(0);

    const status = await ctx.app.request("/status", { headers: { Origin: "https://navajyoth.com" } }, ctx.env);
    expect(await status.json()).toEqual({ enabled: false });
  });

  it("fails closed when the key is missing", async () => {
    const ctx = setup();
    ctx.kv.map.delete("jo:enabled");
    expect(errorCode(await readEvents(await ask(ctx, { question: "hi" })))).toBe("offline");
  });

  it("JO_FORCE_OFF overrides KV", async () => {
    const provider = mockProvider(["hi"]);
    const ctx = setup({ providers: [provider], env: { JO_FORCE_OFF: "true" } });
    expect(errorCode(await readEvents(await ask(ctx, { question: "hi" })))).toBe("offline");
    expect(provider.calls).toHaveLength(0);
  });

  it("is checked before rate limits are consumed", async () => {
    const ctx = setup({ kv: { "jo:enabled": "false" } });
    await (await ask(ctx, { question: "hi" })).text();
    expect(ctx.limiter.store.size).toBe(0);
  });
});
