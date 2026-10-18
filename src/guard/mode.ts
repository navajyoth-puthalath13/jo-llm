// Test mode vs normal mode, switchable at runtime from the usage page (or `npm run jo -- test`).
// Stored in KV next to the kill switch, so a switch takes effect within about 30 seconds with
// no deploy. Normal limits come from wrangler.toml; test mode lifts Jo's own limits so
// Navajyoth can test freely. It can't lift the AI providers' own free quotas.

import type { Config } from "../config";

export const MODE_KEY = "jo:mode";
export type Mode = "normal" | "test";

export const TEST_LIMITS: Config["limits"] = {
  burst: 100_000,
  refillSeconds: 1,
  daily: 100_000,
  globalDailyModelCalls: 100_000,
};

/** Normal unless KV says exactly "test". A KV error means normal: production limits are the safe side. */
export async function readMode(kv: KVNamespace, cacheTtl: number): Promise<Mode> {
  try {
    return (await kv.get(MODE_KEY, { cacheTtl })) === "test" ? "test" : "normal";
  } catch {
    return "normal";
  }
}

export function applyMode(config: Config, mode: Mode): Config {
  return mode === "test" ? { ...config, mode, limits: TEST_LIMITS } : { ...config, mode };
}
