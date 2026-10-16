// The answer pipeline: provider routing → sentinel gate → leak check → sanitizer → caller.
// Runtime-agnostic (no Workers imports) so scripts can reuse it from Node.

import { createStreamSanitizer, containsLeak } from "./guard/output";
import { detectSentinel, type SentinelState } from "./guard/offtopic";
import { openStream, RouteError } from "./providers/router";
import type { Provider } from "./providers/types";

export interface AnswerOptions {
  providers: Provider[];
  system: string;
  user: string;
  maxTokens: number;
  timeoutsMs: number[];
  totalTimeoutMs: number;
  linkAllowlist: string[];
  signal: AbortSignal;
  /** Receives sanitized text as soon as it is safe to show. Throwing stops generation. */
  onText: (text: string) => Promise<void>;
  log?: (provider: string, outcome: string) => void;
  /** Debug-only step trace (local dev). */
  trace?: (step: string, detail: string) => void;
}

export type AnswerOutcome =
  | { ok: true; text: string; provider: string }
  | { ok: false; code: "offtopic" | "busy"; provider?: string; partial: boolean };

export async function generateAnswer(o: AnswerOptions): Promise<AnswerOutcome> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  o.signal.addEventListener("abort", abort, { once: true });
  const total = setTimeout(abort, o.totalTimeoutMs);

  let provider: string | undefined;
  let emitted = "";
  try {
    let opened;
    try {
      opened = await openStream(
        o.providers,
        { system: o.system, user: o.user, maxTokens: o.maxTokens },
        o.timeoutsMs,
        ctrl.signal,
        o.log,
      );
    } catch (err) {
      const code = err instanceof RouteError && err.code === "blocked" ? "offtopic" : "busy";
      return { ok: false, code, partial: false };
    }
    provider = opened.provider;
    o.trace?.("8 model", `${provider} answered first: ${JSON.stringify(opened.first)}`);

    const sanitizer = createStreamSanitizer(o.linkAllowlist);
    let gate: SentinelState = "pending";
    let held = "";

    // ~4 characters per token: the visible answer never exceeds maxTokens, whatever the provider does.
    const maxChars = o.maxTokens * 4;
    let capped = false;
    const emit = async (text: string) => {
      if (!text || capped) return;
      if (emitted.length + text.length > maxChars) {
        text = text.slice(0, Math.max(0, maxChars - emitted.length)).replace(/\S*$/, "");
        capped = true;
        o.trace?.("9 output", "visible length cap reached, stopping");
      }
      emitted += text;
      if (text) await o.onText(text);
    };

    /** Returns false when the answer must be replaced with a decline. */
    const take = async (chunk: string): Promise<boolean> => {
      const out = sanitizer.push(chunk);
      if (containsLeak(sanitizer.raw)) return false;
      if (gate === "pending") {
        gate = detectSentinel(sanitizer.raw);
        if (gate === "offtopic") return false;
      }
      if (gate === "pending") {
        held += out;
        return true;
      }
      await emit(held + out);
      held = "";
      return true;
    };

    const decline = () => ({ ok: false as const, code: "offtopic" as const, provider, partial: emitted.length > 0 });

    const t = o.trace ?? (() => {});
    const declineWith = (why: string) => {
      t("9 output", `raw model text: ${JSON.stringify(sanitizer.raw)}`);
      t("9 output", `✗ replaced with decline (${why})`);
      return decline();
    };

    if (!(await take(opened.first))) return declineWith(sanitizer.raw.includes("OFFTOPIC") ? "model said [[OFFTOPIC]]" : "leak marker");
    try {
      while (true) {
        const r = await opened.rest.next();
        if (r.done) break;
        if (capped) {
          ctrl.abort();
          break;
        }
        if (!(await take(r.value))) {
          ctrl.abort();
          return declineWith(sanitizer.raw.includes("OFFTOPIC") ? "model said [[OFFTOPIC]]" : "leak marker");
        }
      }
    } catch {
      // Upstream failed or timed out mid-answer: keep what we already have.
      if (!emitted && !held && !sanitizer.raw.trim()) return { ok: false, code: "busy", provider, partial: false };
    }

    if (gate === "pending") {
      // Stream ended while still looking like a possible sentinel.
      if (sanitizer.raw.trim()) return declineWith("model said [[OFFTOPIC]]");
      return { ok: false, code: "busy", provider, partial: false };
    }
    await emit(held + sanitizer.flush());
    if (containsLeak(sanitizer.raw)) return declineWith("leak marker");
    t("9 output", `raw model text: ${JSON.stringify(sanitizer.raw)}`);
    t("9 output", `sent to browser:  ${JSON.stringify(emitted.trim())}`);
    if (!emitted.trim()) return { ok: false, code: "busy", provider, partial: false };
    return { ok: true, text: emitted.trim(), provider };
  } finally {
    clearTimeout(total);
    o.signal.removeEventListener("abort", abort);
  }
}
