import { createApp } from "./app";
import { durableLimiter, Limiter } from "./limiter-do";

const app = createApp({
  limiter: (env, config) => {
    if (!env.LIMITER) throw new Error("LIMITER binding missing");
    return durableLimiter(env.LIMITER as DurableObjectNamespace<Limiter>, env.BURST, config.limits);
  },
});

export default app;
export { Limiter };
