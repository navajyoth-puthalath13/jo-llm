// Runtime configuration. Everything tunable lives here, read from env with safe defaults.
// Free-tier model names and limits change often: check them before each deploy.
//   Gemini: https://ai.google.dev/gemini-api/docs/pricing (free tier) and https://aistudio.google.com/rate-limit
//   Groq:   https://console.groq.com/docs/models and https://console.groq.com/settings/limits
// Checked 2026-10-16: gemini-3.5-flash-lite is free (15 requests/minute on this key). Groq's Llama chat
// models are no longer available on free accounts; openai/gpt-oss-120b is, with ~0.35s to first token.

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

  // Vars (wrangler.toml / .dev.vars)
  ALLOWED_ORIGINS?: string;
  LINK_ALLOWLIST?: string;
  GEMINI_MODEL?: string;
  GROQ_MODEL?: string;
  DAILY_BUDGET?: string;
  JO_FORCE_OFF?: string;
}

export interface Config {
  allowedOrigins: string[];
  linkAllowlist: string[];
  geminiModel: string;
  groqModel: string;
  geminiKey: string;
  groqKey: string;
  ipSalt: string;
  forceOff: boolean;

  limits: {
    perIpWindow: number; // questions per window
    perIpWindowSeconds: number;
    perIpDaily: number;
    globalDailyModelCalls: number;
  };

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

export const DEFAULT_ORIGINS = ["https://navajyoth.com", "https://www.navajyoth.com"];
export const DEFAULT_LINKS = ["navajyoth.com", "www.navajyoth.com", "github.com/navajyoth-puthalath13"];

export function loadConfig(env: Env): Config {
  return {
    allowedOrigins: list(env.ALLOWED_ORIGINS, DEFAULT_ORIGINS),
    linkAllowlist: list(env.LINK_ALLOWLIST, DEFAULT_LINKS).map((s) => s.toLowerCase()),
    geminiModel: env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    groqModel: env.GROQ_MODEL || "openai/gpt-oss-120b",
    geminiKey: env.GEMINI_API_KEY ?? "",
    groqKey: env.GROQ_API_KEY ?? "",
    ipSalt: env.IP_SALT ?? "",
    forceOff: env.JO_FORCE_OFF === "true",

    limits: {
      perIpWindow: 8,
      perIpWindowSeconds: 600,
      perIpDaily: 30,
      globalDailyModelCalls: int(env.DAILY_BUDGET, 1000),
    },

    maxBodyBytes: 4096,
    maxOutputTokens: 180,
    firstTokenTimeoutMs: 2500,
    fallbackFirstTokenTimeoutMs: 6000,
    totalTimeoutMs: 20000,
    cacheTtlSeconds: 7 * 24 * 60 * 60,
    statusMaxAgeSeconds: 30,
  };
}
