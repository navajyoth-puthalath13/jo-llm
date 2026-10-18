import { Hono, type Context } from "hono";
import { KNOWLEDGE_SOURCES } from "../content/knowledge/index";
import { resolveActions } from "./actions";
import { cacheKey, chunkAnswer, getCached, putCached } from "./cache";
import { isAllowedOrigin, loadConfig, type Config, type Env } from "./config";
import { isEnabled } from "./guard/killswitch";
import { applyMode, MODE_KEY, readMode } from "./guard/mode";
import { hashIp, type Limiter } from "./guard/ratelimit";
import { linksFromKnowledge } from "./guard/output";
import { parseAsk, readCappedBody } from "./guard/validate";
import { answerCacheScope, runJo } from "./jo";
import {
  forwardUsage,
  probeEvents,
  probeGemini,
  probeGroq,
  recordingProviders,
  UsageBatchSchema,
  type GeminiProbe,
  type GroqProbe,
  type UsageEvent,
} from "./usage";
import { USAGE_CSS, USAGE_HTML, USAGE_JS } from "./usage-page";
import { allFacts, buildKnowledge, type KnowledgeSource } from "./knowledge";
import { defaultProviders, setCooldowns, utilityProviders } from "./providers/router";
import type { Provider } from "./providers/types";
import { createEventStream, errorResponse, SSE_HEADERS, type ErrorCode } from "./sse";

export interface AppDeps {
  /** Builds the limiter for a request. Production wires the Durable Object here. */
  limiter: (env: Env, config: Config) => Limiter;
  /** Override the answer providers (tests). Defaults to the MODELS chain. */
  providers?: (config: Config) => Provider[];
  /** Override the router/button providers (tests). Defaults to the UTILITY_MODELS chain. */
  utilityProviders?: (config: Config) => Provider[];
  /** Override the knowledge files (tests). Defaults to content/knowledge/. */
  knowledge?: KnowledgeSource[];
}

type AppEnv = { Bindings: Env; Variables: { config: Config; origin: string | null } };

/** Logs counts, latency, provider and outcome only. Never questions, never IPs or their hashes. */
function logEvent(fields: Record<string, string | number | boolean | undefined>) {
  console.log(JSON.stringify({ evt: "ask", ...fields }));
}

const STATUS_FOR: Record<ErrorCode, number> = {
  invalid: 400,
  rate_limited: 429,
  offline: 503,
  busy: 503,
  offtopic: 200,
};

/** Local-only step trace, enabled with JO_DEBUG=true in .dev.vars. */
function tracer(config: Config) {
  const t0 = Date.now();
  return (step: string, detail: string) => {
    if (config.debug) console.log(`[jo +${String(Date.now() - t0).padStart(4)}ms] ${step.padEnd(10)} ${detail}`);
  };
}

/** Constant-time check of "Bearer <token>" against the admin token (compares SHA-256 digests). */
async function tokenMatches(header: string | undefined, expected: string): Promise<boolean> {
  const given = /^Bearer (.+)$/.exec(header ?? "")?.[1] ?? "";
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0 && given.length > 0;
}

function waitUntil(c: Context<AppEnv>, p: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(p);
  } catch {
    // No execution context (tests): the promise still runs.
  }
}

export function createApp(deps: AppDeps) {
  const knowledge = buildKnowledge(deps.knowledge ?? KNOWLEDGE_SOURCES);
  const knowledgeLinks = linksFromKnowledge(allFacts(knowledge));
  const cacheScope = answerCacheScope(knowledge);
  const app = new Hono<AppEnv>();

  // Security headers on every response.
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  });

  // CORS allowlist. Unknown origins are rejected before any other work.
  app.use("*", async (c, next) => {
    let config = loadConfig(c.env);
    // Test or normal mode, from KV (cached ~30s), for the routes that use limits.
    if (c.req.path === "/ask" || c.req.path.startsWith("/usage/data")) {
      config = applyMode(config, await readMode(c.env.JO_KV, config.statusMaxAgeSeconds));
      if (c.req.path === "/ask") setCooldowns(config.mode !== "test");
    }
    c.set("config", config);
    const origin = c.req.header("Origin") ?? null;
    // The private usage page calls its own origin; everything else must be on the allowlist.
    const ownPage = c.req.path.startsWith("/usage") && origin === new URL(c.req.url).origin;
    if (origin !== null && !ownPage && !isAllowedOrigin(origin, config.allowedOrigins)) return c.text("Forbidden", 403);
    if (origin === null && c.req.path === "/ask") return c.text("Forbidden", 403);
    c.set("origin", origin);
    await next();
    if (origin) {
      c.res.headers.set("Access-Control-Allow-Origin", origin);
      c.res.headers.append("Vary", "Origin");
    }
  });

  app.options("*", (c) => {
    if (!c.get("origin")) return c.text("Forbidden", 403);
    return c.body(null, 204, {
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
  });

  app.get("/status", async (c) => {
    const config = c.get("config");
    const enabled = await isEnabled(c.env.JO_KV, config);
    return c.json({ enabled }, 200, { "Cache-Control": `public, max-age=${config.statusMaxAgeSeconds}` });
  });

  app.post("/ask", async (c) => {
    const config = c.get("config");
    const started = Date.now();
    const trace = tracer(config);
    const fail = (code: ErrorCode, extra: Record<string, string | number | boolean | undefined> = {}) => {
      trace("✗ stop", `→ error "${code}"${extra.reason ? ` (${extra.reason})` : ""}`);
      logEvent({ outcome: code, ms: Date.now() - started, ...extra });
      return errorResponse(code, STATUS_FOR[code]);
    };

    trace("─────────", "new question");
    trace("1 origin", `✓ ${c.get("origin")} is allowed`);
    if (!(await isEnabled(c.env.JO_KV, config))) return fail("offline");
    trace("2 switch", "✓ kill switch is on");

    const contentType = c.req.header("Content-Type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) return fail("invalid");
    const raw = await readCappedBody(c.req.raw, config.maxBodyBytes);
    if (raw === null) return fail("invalid");
    const input = parseAsk(raw);
    if (!input) return fail("invalid");
    trace(
      "3 validate",
      `✓ question ${JSON.stringify(input.question.slice(0, 80))}${input.quote ? `, quote ${input.quote.length} chars` : ""}${input.history ? `, ${input.history.length} past exchanges` : ""}`,
    );

    if (!config.ipSalt) return fail("busy"); // misconfigured: refuse rather than key on raw IPs
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const limiter = deps.limiter(c.env, config);
    try {
      if ((await limiter.hit(await hashIp(ip, config.ipSalt))) === "rate_limited") return fail("rate_limited");
    } catch {
      return fail("busy");
    }
    trace("4 limits", "✓ under the per-IP limits");

    const cacheable = !input.quote && !input.history?.length;
    const key = cacheable ? await cacheKey(input.question, cacheScope) : null;
    if (!key) trace("5 cache", "skipped: questions with a quote or history are never cached");

    if (key) {
      const hit = await getCached(c.env.JO_KV, key);
      trace("5 cache", hit ? "✓ cache hit: streaming saved answer, no model call" : "miss: will ask a model");
      if (hit) {
        const { readable, writer } = createEventStream();
        waitUntil(
          c,
          (async () => {
            try {
              for (const t of chunkAnswer(hit.text)) await writer.token(t);
              const actions = resolveActions(hit.actions);
              if (actions.length) await writer.actions(actions);
              await writer.done(true);
            } catch {
              // client went away
            } finally {
              await writer.close();
            }
            logEvent({ outcome: "ok", cached: true, ms: Date.now() - started });
          })(),
        );
        return new Response(readable, { headers: SSE_HEADERS });
      }
    }

    // Every model call this question makes is recorded for the private usage page.
    const usageEvents: UsageEvent[] = [];
    const record = (e: UsageEvent) => void usageEvents.push(e);
    const providers = recordingProviders((deps.providers ?? defaultProviders)(config), record);
    if (providers.length === 0) return fail("busy", { reason: "no_providers" });
    const utility = recordingProviders((deps.utilityProviders ?? utilityProviders)(config), record);

    // One visitor question is one budget unit, whatever it costs: the router and button calls
    // (small, on the utility models) ride along with the answer. Cached answers cost nothing.
    try {
      if (!(await limiter.spend())) return fail("busy", { reason: "budget" });
    } catch {
      return fail("busy");
    }
    trace("6 budget", "✓ global daily budget has room (one unit covers route + answer + buttons)");

    const { readable, writer } = createEventStream();
    const clientGone = new AbortController();

    const run = (async () => {
      let firstTokenMs: number | undefined;
      const result = await runJo({
        input,
        knowledge,
        answerProviders: providers,
        utilityProviders: utility,
        config,
        linkAllowlist: [...config.linkAllowlist, ...knowledgeLinks],
        signal: clientGone.signal,
        onText: async (t) => {
          firstTokenMs ??= Date.now() - started;
          try {
            await writer.token(t);
          } catch (err) {
            clientGone.abort();
            throw err;
          }
        },
        log: (provider, result) => logEvent({ outcome: "provider_fallthrough", provider, result }),
        trace,
      }).catch(() => null);
      const outcome = result?.outcome ?? { ok: false as const, code: "busy" as const, partial: false };

      try {
        if (outcome.ok) {
          const ids = result?.actions ?? [];
          const actions = resolveActions(ids);
          if (actions.length) await writer.actions(actions);
          await writer.done(false);
          if (key) await putCached(c.env.JO_KV, key, { text: outcome.text, actions: ids }, config.cacheTtlSeconds);
        } else {
          await writer.error(outcome.code);
        }
      } catch {
        // client went away
      } finally {
        await writer.close();
      }
      if (usageEvents.length) {
        await limiter.recordUsage(usageEvents).catch(() => {});
        // Local dev server: count these calls on the live usage page too.
        await forwardUsage(config.usageForwardUrl, config.usageForwardToken, usageEvents);
      }
      trace("done", outcome.ok ? `✓ answered by ${outcome.provider}, first word at ${firstTokenMs}ms` : `→ error "${outcome.code}"`);
      logEvent({
        outcome: outcome.ok ? "ok" : outcome.code,
        provider: outcome.provider,
        route: result?.route.source,
        intent: result?.route.intent,
        buttons: result?.buttonSource,
        cached: false,
        ttft: firstTokenMs,
        ms: Date.now() - started,
      });
    })();
    waitUntil(c, run);

    return new Response(readable, { headers: SSE_HEADERS });
  });

  // ── Private usage page ──────────────────────────────────────────────────────
  // Off unless ADMIN_TOKEN is set. The page has no data in it; /usage/data needs the token.
  const PAGE_CSP =
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const asset = (body: string, type: string) => (c: Context<AppEnv>) => {
    if (!c.get("config").adminToken) return c.text("Not found", 404);
    return c.body(body, 200, { "Content-Type": type, "Content-Security-Policy": PAGE_CSP, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
  };
  app.get("/usage", asset(USAGE_HTML, "text/html; charset=utf-8"));
  app.get("/usage/app.css", asset(USAGE_CSS, "text/css; charset=utf-8"));
  app.get("/usage/app.js", asset(USAGE_JS, "text/javascript; charset=utf-8"));

  app.get("/usage/data", async (c) => {
    const config = c.get("config");
    if (!config.adminToken) return c.text("Not found", 404);
    if (!(await tokenMatches(c.req.header("Authorization"), config.adminToken))) {
      return c.json({ error: "unauthorized" }, 401, { "Cache-Control": "no-store" });
    }
    const now = Date.now();
    const name = (m: { provider: string; model: string }) => `${m.provider}:${m.model}`;
    const known = [...new Set([...config.models, ...config.utilityModels].map(name))];
    const limiter = deps.limiter(c.env, config);
    const modelsOf = (provider: string) =>
      [...new Set([...config.models, ...config.utilityModels].filter((m) => m.provider === provider).map((m) => m.model))];
    // Checks ask the providers directly; what they say is saved, so the page keeps showing it.
    let probe: GroqProbe[] | undefined;
    let geminiProbe: GeminiProbe[] | undefined;
    const check = c.req.query("probe");
    if ((check === "1" || check === "groq") && config.groqKey) {
      probe = await Promise.all(
        modelsOf("groq").map((m) => probeGroq(config.groqKey, m).catch(() => ({ model: `groq:${m}`, status: 0 }) as GroqProbe)),
      );
    }
    if (check === "gemini" && config.geminiKey) {
      geminiProbe = await Promise.all(
        modelsOf("gemini").map((m) => probeGemini(config.geminiKey, m).catch(() => ({ model: `gemini:${m}`, status: 0 }))),
      );
    }
    const checked = probeEvents([...(probe ?? []), ...(geminiProbe ?? [])]);
    if (checked.length) await limiter.recordUsage(checked).catch(() => {});
    const stats = await limiter.stats(known);
    const utcMidnight = new Date(now);
    utcMidnight.setUTCHours(24, 0, 0, 0);
    return c.json(
      {
        now,
        jo: {
          enabled: await isEnabled(c.env.JO_KV, config),
          forceOff: config.forceOff,
          testMode: config.mode === "test",
          mode: config.mode,
          limits: config.limits,
          // The limits Normal mode applies, so the page can describe them while in test mode.
          normalLimits: loadConfig(c.env).limits,
          models: config.models.map(name),
          utilityModels: config.utilityModels.map(name),
          answerReasoning: config.answerReasoning,
        },
        stats,
        resets: { utcMidnightInMs: utcMidnight.getTime() - now },
        probe,
        geminiProbe,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  // Switch between normal and test mode from the usage page. Takes effect within ~30 seconds.
  app.post("/usage/mode", async (c) => {
    const config = c.get("config");
    if (!config.adminToken) return c.text("Not found", 404);
    if (!(await tokenMatches(c.req.header("Authorization"), config.adminToken))) {
      return c.json({ error: "unauthorized" }, 401, { "Cache-Control": "no-store" });
    }
    const raw = await readCappedBody(c.req.raw, 1024);
    let mode: unknown;
    try {
      mode = raw === null ? null : (JSON.parse(raw) as { mode?: unknown }).mode;
    } catch {
      mode = null;
    }
    if (mode !== "test" && mode !== "normal") return c.json({ error: "invalid" }, 400, { "Cache-Control": "no-store" });
    await c.env.JO_KV.put(MODE_KEY, mode);
    return c.json({ mode }, 200, { "Cache-Control": "no-store" });
  });

  // Laptop tests and the local dev server report the model calls they made with the same keys.
  app.post("/usage/record", async (c) => {
    const config = c.get("config");
    if (!config.adminToken) return c.text("Not found", 404);
    if (!(await tokenMatches(c.req.header("Authorization"), config.adminToken))) {
      return c.json({ error: "unauthorized" }, 401, { "Cache-Control": "no-store" });
    }
    const raw = await readCappedBody(c.req.raw, 32_768);
    let parsed: ReturnType<typeof UsageBatchSchema.safeParse> | null = null;
    try {
      parsed = raw === null ? null : UsageBatchSchema.safeParse(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) return c.json({ error: "invalid" }, 400, { "Cache-Control": "no-store" });
    await deps.limiter(c.env, config).recordUsage(parsed.data.events);
    return c.json({ recorded: parsed.data.events.length }, 200, { "Cache-Control": "no-store" });
  });

  app.notFound((c) => c.text("Not found", 404));
  app.onError((_err, c) => c.text("Error", 500));

  return app;
}
