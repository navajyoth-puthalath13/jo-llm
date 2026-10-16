import type { Config } from "../config";

export const KILL_SWITCH_KEY = "jo:enabled";

/**
 * Jo is on only when KV says exactly "true" and the emergency env override is not set.
 * Fails closed: a missing key or a KV error means off. KV reads are edge-cached for 30s,
 * so flipping the switch takes effect everywhere within about 30 seconds.
 */
export async function isEnabled(kv: KVNamespace, config: Config): Promise<boolean> {
  if (config.forceOff) return false;
  try {
    return (await kv.get(KILL_SWITCH_KEY, { cacheTtl: config.statusMaxAgeSeconds })) === "true";
  } catch {
    return false;
  }
}
