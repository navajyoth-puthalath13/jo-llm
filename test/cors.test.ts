import { describe, expect, it } from "vitest";
import { ask, mockProvider, readEvents, setup } from "./helpers";

describe("CORS and headers", () => {
  it("rejects unknown origins with 403 before doing any work", async () => {
    const provider = mockProvider(["hi"]);
    const ctx = setup({ providers: [provider] });
    const res = await ask(ctx, { question: "hi" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects /ask with no Origin header", async () => {
    const ctx = setup();
    const res = await ask(ctx, { question: "hi" }, { origin: null });
    expect(res.status).toBe(403);
  });

  it("rejects unknown origins on /status too", async () => {
    const ctx = setup();
    const res = await ctx.app.request("/status", { headers: { Origin: "https://evil.example" } }, ctx.env);
    expect(res.status).toBe(403);
  });

  it("answers preflight for allowed origins", async () => {
    const ctx = setup();
    const res = await ctx.app.request(
      "/ask",
      { method: "OPTIONS", headers: { Origin: "https://www.navajyoth.com", "Access-Control-Request-Method": "POST" } },
      ctx.env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://www.navajyoth.com");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });

  it("allows localhost only when configured", async () => {
    const ctx = setup({ env: { ALLOWED_ORIGINS: "https://navajyoth.com" } });
    const res = await ask(ctx, { question: "hi" }, { origin: "http://localhost:3000" });
    expect(res.status).toBe(403);
  });

  it("sets security headers and streams to allowed origins", async () => {
    const ctx = setup();
    const res = await ask(ctx, { question: "What do you do?" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://navajyoth.com");
    const events = await readEvents(res);
    expect(events.at(-1)).toEqual({ event: "done", data: { cached: false } });
  });

  it("GET /status reports enabled with a 30s cache", async () => {
    const ctx = setup();
    const res = await ctx.app.request("/status", { headers: { Origin: "https://navajyoth.com" } }, ctx.env);
    expect(await res.json()).toEqual({ enabled: true });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
  });
});
