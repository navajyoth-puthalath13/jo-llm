import { createApp } from "../src/app";
import { loadConfig, type Env } from "../src/config";
import { memoryLimiter } from "../src/guard/ratelimit";
import type { Provider } from "../src/providers/types";

export const ORIGIN = "https://navajyoth.com";

export function fakeKV(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const kv = {
    map,
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => void map.set(k, v),
    delete: async (k: string) => void map.delete(k),
  };
  return kv as typeof kv & KVNamespace;
}

/** A provider that streams the given chunks, optionally after a delay. Records calls. */
export function mockProvider(chunks: string[], opts: { name?: string; delayMs?: number; fail?: boolean } = {}) {
  const calls: { system: string; user: string }[] = [];
  const provider: Provider & { calls: typeof calls } = {
    name: opts.name ?? "mock",
    calls,
    async *stream(req, signal) {
      calls.push({ system: req.system, user: req.user });
      if (opts.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.delayMs);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        });
      }
      if (opts.fail) throw new Error("upstream down");
      for (const c of chunks) yield c;
    },
  };
  return provider;
}

export function setup(opts: { providers?: Provider[]; env?: Partial<Env>; kv?: Record<string, string> } = {}) {
  const kv = fakeKV({ "jo:enabled": "true", ...opts.kv });
  const env: Env = {
    JO_KV: kv,
    IP_SALT: "test-salt",
    ALLOWED_ORIGINS: "https://navajyoth.com,https://www.navajyoth.com,http://localhost:3000",
    LINK_ALLOWLIST: "navajyoth.com,github.com/navajyoth-puthalath13,mailto:hello@navajyoth.com",
    ...opts.env,
  };
  const limiter = memoryLimiter(loadConfig(env).limits);
  const providers = opts.providers ?? [mockProvider(["I design ", "and build ", "things."])];
  const app = createApp({ limiter: () => limiter, providers: () => providers, joMd: "# Jo\nI am Jo." });
  return { app, env, kv, limiter, providers };
}

export function ask(
  ctx: ReturnType<typeof setup>,
  body: unknown,
  init: { origin?: string | null; ip?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...init.headers };
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN;
  headers["CF-Connecting-IP"] = init.ip ?? "203.0.113.7";
  return ctx.app.request(
    "/ask",
    { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) },
    ctx.env,
  );
}

export interface ParsedEvent {
  event: string;
  data: Record<string, unknown>;
}

export async function readEvents(res: Response): Promise<ParsedEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event: (.*)$/m)?.[1] ?? "";
      const data = JSON.parse(block.match(/^data: (.*)$/m)?.[1] ?? "{}");
      return { event, data };
    });
}

export const answerText = (events: ParsedEvent[]) =>
  events
    .filter((e) => e.event === "token")
    .map((e) => e.data.t)
    .join("");

export const errorCode = (events: ParsedEvent[]) => events.find((e) => e.event === "error")?.data.code;
