// Runtime configuration. Everything tunable lives here, read from env with safe defaults.
// Free-tier model names and limits change often: check them before each deploy.
//   Gemini: https://ai.google.dev/gemini-api/docs/pricing (free tier) and https://aistudio.google.com/rate-limit
//   Groq:   https://console.groq.com/docs/models and https://console.groq.com/settings/limits
// Checked 2026-10-16 (free tier, this account):
//   groq   openai/gpt-oss-120b, openai/gpt-oss-20b: 8,000 tokens/min, 200,000 tokens/day and
//          1,000 requests/day EACH, ~0.5s to first word. The daily token cap is the real ceiling.
//   gemini gemini-3.5-flash-lite, gemini-3.1-flash-lite: 15 requests/min each, 2–8s to first word
// A Jo question used to cost ~4,500 tokens with the whole knowledge file in every prompt; with
// routing it is ~2,000-2,500, so one Groq model serves roughly 3 questions a minute.
// Every model has its own quota, so chaining them multiplies capacity.

/** Workers Rate Limiting binding (declared locally so we don't depend on a specific workers-types version). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  JO_KV: KVNamespace;
  LIMITER?: DurableObjectNamespace;
  BURST?: RateLimitBinding;

  // Secrets (wrangler secret put)
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  IP_SALT?: string;
  /** Opens the private usage page's data (/usage/data). Unset: the page is disabled. */
  ADMIN_TOKEN?: string;
  /** Local dev only: also count this server's model calls on the live usage page. */
  USAGE_FORWARD_URL?: string;
  USAGE_FORWARD_TOKEN?: string;

  // Vars (wrangler.toml / .dev.vars)
  ALLOWED_ORIGINS?: string;
  LINK_ALLOWLIST?: string;
  /** Answer models to try in order, as provider:model, e.g. "groq:openai/gpt-oss-120b,gemini:gemini-3.6-flash". */
  MODELS?: string;
  /** Models for the small structured calls (router, button picker), same format. */
  UTILITY_MODELS?: string;
  /** gpt-oss reasoning effort for answers: low | medium | high. */
  ANSWER_REASONING?: string;
  DAILY_BUDGET?: string;
  PER_IP_BURST?: string;
  PER_IP_REFILL_SECONDS?: string;
  PER_IP_DAILY?: string;
  JO_FORCE_OFF?: string;
  /** Local dev only: print every pipeline step. Never set this in production. */
  JO_DEBUG?: string;
}

export type ProviderName = "groq" | "gemini";

export interface ModelChoice {
  provider: ProviderName;
  model: string;
}

export interface Config {
  allowedOrigins: string[];
  linkAllowlist: string[];
  /** Answer models, in order. Groq models get the short first-token deadline. */
  models: ModelChoice[];
  /** Router and button-picker models, in order. */
  utilityModels: ModelChoice[];
  answerReasoning: "low" | "medium" | "high";
  routerBudgetMs: number;
  buttonsBudgetMs: number;
  geminiKey: string;
  groqKey: string;
  ipSalt: string;
  adminToken: string;
  usageForwardUrl: string;
  usageForwardToken: string;
  forceOff: boolean;
  /** "test" lifts Jo's own limits (see guard/mode.ts). Set per request from KV. */
  mode: "normal" | "test";
  debug: boolean;

  limits: Limits;

  maxBodyBytes: number;
  maxOutputTokens: number;
  firstTokenTimeoutMs: number; // primary provider
  fallbackFirstTokenTimeoutMs: number;
  totalTimeoutMs: number; // hard cap on a whole answer
  cacheTtlSeconds: number;
  statusMaxAgeSeconds: number;
}

const list = (v: string | undefined, fallback: string[]): string[] => {
  const items = (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
};

const int = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Fast Groq models first, slower Gemini models as extra capacity.
// Answers: the strongest free models only. Groq gpt-oss-120b first (fast; 200,000 tokens a day on
// the free tier, about 65 questions). Then Gemini 3.6 Flash with low thinking: ~2.5s to the first
// word but grounded. Flash-Lite and gpt-oss-20b are not used for answers: in testing both invented
// facts that weren't in the knowledge files. They only do the small structured calls.
export const DEFAULT_MODELS: ModelChoice[] = [
  { provider: "groq", model: "openai/gpt-oss-120b" },
  { provider: "gemini", model: "gemini-3.6-flash" },
];

// Router and button picker: small, fast, structured output (strict json_schema on Groq).
export const DEFAULT_UTILITY_MODELS: ModelChoice[] = [
  { provider: "groq", model: "openai/gpt-oss-20b" },
  { provider: "gemini", model: "gemini-3.5-flash-lite" },
];

export function parseModels(v: string | undefined, fallback: ModelChoice[] = DEFAULT_MODELS): ModelChoice[] {
  const seen = new Set<string>();
  const out: ModelChoice[] = [];
  for (const item of list(v, [])) {
    const i = item.indexOf(":");
    const provider = item.slice(0, i);
    const model = item.slice(i + 1).trim();
    if (i < 1 || !model || (provider !== "groq" && provider !== "gemini") || seen.has(item)) continue;
    seen.add(item);
    out.push({ provider, model });
  }
  return out.length ? out : fallback;
}

/**
 * Per-person limits are sized so a real conversation never meets them; they exist to stop
 * scripts. Each visitor has a bucket of `burst` questions that refills one question every
 * `refillSeconds`. `daily` is a fairness cap so one visitor can't spend everyone's free quota.
 */
export interface Limits {
  burst: number;
  refillSeconds: number;
  daily: number;
  globalDailyModelCalls: number;
}

export const DEFAULT_ORIGINS = ["https://navajyoth.com", "https://www.navajyoth.com"];

/**
 * Whether `origin` is on the allowlist. Entries are exact origins, or an origin
 * with one or more `*` wildcards for Vercel previews, e.g.
 * `https://portfolio-*-navajyoth-puthalath13s-projects.vercel.app`. A `*`
 * matches letters, digits and hyphens only — never a dot, colon or slash — so
 * it can't stretch into another host (`…vercel.app.evil.com`) or scheme.
 */
export function isAllowedOrigin(origin: string, allowed: string[]): boolean {
  const o = origin.toLowerCase();
  return allowed.some((entry) => {
    const e = entry.toLowerCase();
    if (!e.includes("*")) return e === o;
    const pattern = e
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[a-z0-9-]+");
    return new RegExp(`^${pattern}$`).test(o);
  });
}
export const DEFAULT_LINKS = ["navajyoth.com", "www.navajyoth.com", "github.com/navajyoth-puthalath13"];

export function loadConfig(env: Env): Config {
  return {
    allowedOrigins: list(env.ALLOWED_ORIGINS, DEFAULT_ORIGINS),
    linkAllowlist: list(env.LINK_ALLOWLIST, DEFAULT_LINKS).map((s) => s.toLowerCase()),
    models: parseModels(env.MODELS),
    utilityModels: parseModels(env.UTILITY_MODELS, DEFAULT_UTILITY_MODELS),
    answerReasoning: env.ANSWER_REASONING === "low" || env.ANSWER_REASONING === "high" ? env.ANSWER_REASONING : "medium",
    routerBudgetMs: 800,
    buttonsBudgetMs: 1000,
    geminiKey: env.GEMINI_API_KEY ?? "",
    groqKey: env.GROQ_API_KEY ?? "",
    ipSalt: env.IP_SALT ?? "",
    adminToken: env.ADMIN_TOKEN ?? "",
    usageForwardUrl: env.USAGE_FORWARD_URL ?? "",
    usageForwardToken: env.USAGE_FORWARD_TOKEN ?? "",
    forceOff: env.JO_FORCE_OFF === "true",
    mode: "normal",
    debug: env.JO_DEBUG === "true",

    limits: {
      burst: int(env.PER_IP_BURST, 15),
      refillSeconds: int(env.PER_IP_REFILL_SECONDS, 6),
      daily: int(env.PER_IP_DAILY, 150),
      globalDailyModelCalls: int(env.DAILY_BUDGET, 2000),
    },

    maxBodyBytes: 8192,
    maxOutputTokens: 240,
    firstTokenTimeoutMs: 2500,
    // Gemini's free tier often takes 3–8s to start. When Groq is full, a slow answer beats "busy".
    fallbackFirstTokenTimeoutMs: 10000,
    totalTimeoutMs: 30000,
    cacheTtlSeconds: 7 * 24 * 60 * 60,
    statusMaxAgeSeconds: 30,
  };
}
