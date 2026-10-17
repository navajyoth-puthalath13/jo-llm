import { createApp } from "../src/app";
import { loadConfig, type Env } from "../src/config";
import { memoryLimiter } from "../src/guard/ratelimit";
import type { JsonRequest, Provider } from "../src/providers/types";

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

/**
 * A provider for the small structured calls (router, buttons). `reply` returns the JSON text for
 * each request; requests are recorded so tests can check what the model saw.
 */
export function mockJsonProvider(
  reply: string | ((req: JsonRequest) => string),
  opts: { name?: string; delayMs?: number; fail?: Error } = {},
) {
  const calls: JsonRequest[] = [];
  const provider: Provider & { calls: JsonRequest[] } = {
    name: opts.name ?? "mock-json",
    calls,
    async *stream() {
      throw new Error("not a streaming provider");
    },
    async json(req, signal) {
      calls.push(req);
      if (opts.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.delayMs);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        });
      }
      if (opts.fail) throw opts.fail;
      return typeof reply === "function" ? reply(req) : reply;
    },
  };
  return provider;
}

/** Routes by the request schema name: "route" calls get `route`, "buttons" calls get `buttons`. */
export function mockUtility(route: object | null, buttons: object | null = null) {
  return mockJsonProvider((req) => {
    const v = req.name === "route" ? route : buttons;
    if (v === null) throw new Error(`no mock reply for ${req.name}`);
    return JSON.stringify(v);
  });
}

export function setup(
  opts: { providers?: Provider[]; utility?: Provider[]; env?: Partial<Env>; kv?: Record<string, string> } = {},
) {
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
  // No utility providers by default: routing uses keywords and buttons use the fallback rules,
  // so tests are deterministic unless they pass a mock router/button model.
  const utility = opts.utility ?? [];
  const app = createApp({ limiter: () => limiter, providers: () => providers, utilityProviders: () => utility });
  return { app, env, kv, limiter, providers, utility };
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
