import { Hono, type Context } from "hono";
import { KNOWLEDGE_SOURCES } from "../content/knowledge/index";
import { resolveActions } from "./actions";
import { cacheKey, chunkAnswer, getCached, putCached } from "./cache";
import { isAllowedOrigin, loadConfig, type Config, type Env } from "./config";
import { isEnabled } from "./guard/killswitch";
import { hashIp, type Limiter } from "./guard/ratelimit";
import { linksFromKnowledge } from "./guard/output";
import { parseAsk, readCappedBody } from "./guard/validate";
import { answerCacheScope, runJo } from "./jo";
import { allFacts, buildKnowledge, type KnowledgeSource } from "./knowledge";
import { defaultProviders, utilityProviders } from "./providers/router";
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
    const config = loadConfig(c.env);
    c.set("config", config);
    const origin = c.req.header("Origin") ?? null;
    if (origin !== null && !isAllowedOrigin(origin, config.allowedOrigins)) return c.text("Forbidden", 403);
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

    const providers = (deps.providers ?? defaultProviders)(config);
    if (providers.length === 0) return fail("busy", { reason: "no_providers" });
    const utility = (deps.utilityProviders ?? utilityProviders)(config);

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

  app.notFound((c) => c.text("Not found", 404));
  app.onError((_err, c) => c.text("Error", 500));

  return app;
}
