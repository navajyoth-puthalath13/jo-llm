export interface ProviderRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Called with the total tokens the provider billed for this request, when it reports them. */
  onUsage?: (tokens: number) => void;
}

/** A small structured call: the model must return JSON matching `schema`. No tools, no streaming. */
export interface JsonRequest {
  system: string;
  user: string;
  /** JSON Schema (strict-mode subset: every property required, additionalProperties false). */
  schema: Record<string, unknown>;
  /** Schema name, letters/digits/underscores. */
  name: string;
  maxTokens: number;
  onUsage?: (tokens: number) => void;
}

export interface Provider {
  /** Short name for logs only. Never sent to the browser. */
  readonly name: string;
  /** Streams answer text. Must honour `signal` (abort the upstream fetch). */
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<string>;
  /** Returns the raw JSON text of a structured response. The caller validates it. */
  json?(req: JsonRequest, signal: AbortSignal): Promise<string>;
}

/** The provider refused or blocked the content (safety filters). Not worth retrying elsewhere. */
export class ProviderBlockedError extends Error {
  constructor() {
    super("blocked");
  }
}

/** Upstream HTTP error. `status` and `detail` are for logs and the private usage page; they
 *  never reach a visitor's browser. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    /** Seconds the provider asked us to wait (Retry-After), if it said. */
    readonly retryAfterSeconds?: number,
    /** For 429s: the provider's own limit numbers, e.g. "tokens per day: used 197,695 of 200,000". */
    readonly detail?: string,
  ) {
    super(`upstream ${status}`);
  }
}

const fmt = (n: string) => Number(n).toLocaleString("en-US");
/** "2m32.928s." → "2m32s" */
const cleanWait = (s: string) => s.replace(/\.+$/, "").replace(/\.\d+s$/, "s");

/**
 * Pulls the useful numbers out of a provider's rate-limit message. Only numbers and limit names
 * are kept (no account ids), so it is safe to store and show on the private usage page.
 */
export function limitDetail(message: string): string | undefined {
  const m = message.replace(/\s+/g, " ");
  // Groq: "... on tokens per day (TPD): Limit 200000, Used 197695, Requested 2659. Please try again in 2m32.9s."
  const groq = /on (tokens|requests) per (minute|day) \((?:TPM|TPD|RPM|RPD)\): Limit (\d+), Used (\d+), Requested (\d+)\.(?: Please try again in ([\dhms.]+))?/i.exec(m);
  if (groq) {
    const [, what, per, limit, used, requested, retry] = groq;
    return `${what} per ${per}: used ${fmt(used!)} of ${fmt(limit!)}, needed ${fmt(requested!)}${retry ? `; retry in ${cleanWait(retry)}` : ""}`;
  }
  // Gemini: "Quota exceeded for metric: ...free_tier_requests, limit: 20, model: gemini-3.6-flash Please retry in 14h40m50.4s."
  const gemini = /limit: (\d+)/i.exec(m);
  if (gemini && /quota|rate/i.test(m)) {
    const per = /PerDay/i.test(m) || /free_tier_requests/i.test(m) ? "requests per day" : "requests";
    const retry = /retry in ([\dhms.]+)/i.exec(m)?.[1];
    return `${per}: limit ${fmt(gemini[1]!)}${retry ? `; resets in ${cleanWait(retry)}` : ""}`;
  }
  return undefined;
}

/** Builds the error for a failed upstream response, keeping any Retry-After hint and limit detail. */
export async function httpError(res: Response): Promise<ProviderHttpError> {
  const retry = Number.parseFloat(res.headers.get("retry-after") ?? "");
  let detail: string | undefined;
  if (res.status === 429) {
    try {
      detail = limitDetail((await res.text()).slice(0, 4000));
    } catch {
      detail = undefined;
    }
  }
  return new ProviderHttpError(res.status, Number.isFinite(retry) && retry >= 0 ? retry : undefined, detail);
}
