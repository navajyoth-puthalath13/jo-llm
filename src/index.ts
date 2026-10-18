import { createApp } from "./app";
import { durableLimiter, Limiter } from "./limiter-do";

const app = createApp({
  limiter: (env, config) => {
    if (!env.LIMITER) throw new Error("LIMITER binding missing");
    // Test mode skips the flood filter too (its limit lives in wrangler.toml and can't change at runtime).
    return durableLimiter(env.LIMITER as DurableObjectNamespace<Limiter>, config.mode === "test" ? undefined : env.BURST, config.limits);
  },
});

export default app;
export { Limiter };
