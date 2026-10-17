// The answer pipeline: provider routing → sentinel gate → leak check → sanitizer → caller.
// Runtime-agnostic (no Workers imports) so scripts can reuse it from Node.

import { createTagSplitter } from "./actions";
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

/** Index just after the last sentence end (".", "!", "?" or "…", plus closing quotes), or 0. */
export function lastSentenceEnd(text: string): number {
  let end = 0;
  for (const m of text.matchAll(/[.!?…]+["'”’)\]]*(?=\s|$)/g)) end = m.index! + m[0].length;
  return end;
}

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
    o.trace?.("9 model", `${provider} answered first: ${JSON.stringify(opened.first)}`);

    const sanitizer = createStreamSanitizer(o.linkAllowlist);
    // Everything from "[[" on is held back and never shown: a guard in case a model still writes
    // an old-style [[ACT:…]] tag or other bracketed markup.
    const splitter = createTagSplitter();
    // Full model text, tag included. Leak and sentinel checks always run on this.
    let raw = "";
    let gate: SentinelState = "pending";
    let held = "";

    // ~4 characters per token: the visible answer never exceeds maxTokens, whatever the provider
    // does. Past three quarters of the cap, text is released only in whole sentences, so a capped
    // answer ends at a full stop instead of mid-thought.
    const maxChars = o.maxTokens * 4;
    const softChars = Math.floor(maxChars * 0.75);
    let capped = false;
    let tail = "";
    const send = async (text: string) => {
      if (!text) return;
      emitted += text;
      await o.onText(text);
    };
    const emit = async (text: string) => {
      if (!text || capped) return;
      if (!tail && emitted.length + text.length <= softChars) return send(text);
      tail += text;
      const room = maxChars - emitted.length;
      if (tail.length > room) {
        const window = tail.slice(0, room);
        const cut = lastSentenceEnd(window) || window.replace(/\S*$/, "").length;
        await send(window.slice(0, cut));
        tail = "";
        capped = true;
        o.trace?.("10 output", "length cap reached, trimmed to the last full sentence");
        return;
      }
      const cut = lastSentenceEnd(tail);
      if (cut) {
        await send(tail.slice(0, cut));
        tail = tail.slice(cut);
      }
    };
    /** At the natural end of the answer, whatever is held is a complete answer: release it. */
    const flushTail = async () => {
      if (!capped && tail) await send(tail);
      tail = "";
    };

    /** Returns false when the answer must be replaced with a decline. */
    const take = async (chunk: string): Promise<boolean> => {
      raw += chunk;
      const out = sanitizer.push(splitter.push(chunk));
      if (containsLeak(raw)) return false;
      if (gate === "pending") {
        gate = detectSentinel(raw);
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
      t("10 output", `raw model text: ${JSON.stringify(raw)}`);
      t("10 output", `✗ replaced with decline (${why}); any actions dropped`);
      return decline();
    };

    if (!(await take(opened.first))) return declineWith(raw.includes("OFFTOPIC") ? "model said [[OFFTOPIC]]" : "leak marker");
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
          return declineWith(raw.includes("OFFTOPIC") ? "model said [[OFFTOPIC]]" : "leak marker");
        }
      }
    } catch {
      // Upstream failed or timed out mid-answer: keep what we already have.
      if (!emitted && !held && !raw.trim()) return { ok: false, code: "busy", provider, partial: false };
    }

    if (gate === "pending") {
      // Stream ended while still looking like a possible sentinel.
      if (raw.trim()) return declineWith("model said [[OFFTOPIC]]");
      return { ok: false, code: "busy", provider, partial: false };
    }
    await emit(held + sanitizer.push(splitter.flush()) + sanitizer.flush());
    await flushTail();
    if (containsLeak(raw)) return declineWith("leak marker");
    t("10 output", `raw model text: ${JSON.stringify(raw)}`);
    t("10 output", `sent to browser:  ${JSON.stringify(emitted.trim())}`);
    if (!emitted.trim()) return { ok: false, code: "busy", provider, partial: false };
    // The answer model no longer picks buttons (see buttons.ts). Any bracketed tail it still
    // writes was held back above and is ignored here.
    if (splitter.held) t("10 output", `ignored a bracketed tail: ${JSON.stringify(splitter.held.trim().slice(0, 60))}`);
    return { ok: true, text: emitted.trim(), provider };
  } finally {
    clearTimeout(total);
    o.signal.removeEventListener("abort", abort);
  }
}
