// One visitor question, end to end: route → answer → buttons.
// Runtime-agnostic (no Workers imports): the Worker and `npm run eval` both use it, so the eval
// measures exactly what visitors get.

import { catalogFingerprint } from "./actions";
import { generateAnswer, type AnswerOutcome } from "./answer";
import { pickButtons } from "./buttons";
import type { Config } from "./config";
import type { AskInput } from "./guard/validate";
import { renderKnowledge, type Knowledge } from "./knowledge";
import { buildSystemPrompt, buildUserMessage, RULES } from "./prompt";
import { firstTokenTimeouts } from "./providers/router";
import type { Provider } from "./providers/types";
import { filesForAnswer, routeQuestion, type Route } from "./route";

/** Everything an answer depends on. Any change to a knowledge file, the rules or the catalog
 *  changes this, which invalidates cached answers. */
export function answerCacheScope(knowledge: Knowledge): string {
  return `${knowledge.fingerprint}\n${RULES}\n${catalogFingerprint()}`;
}

export interface JoRunOptions {
  input: AskInput;
  knowledge: Knowledge;
  answerProviders: Provider[];
  utilityProviders: Provider[];
  config: Config;
  linkAllowlist: string[];
  signal: AbortSignal;
  onText: (text: string) => Promise<void>;
  trace?: (step: string, detail: string) => void;
  log?: (provider: string, outcome: string) => void;
}

export interface JoResult {
  route: Route;
  /** The routed files plus always-files the answer was written from. */
  files: string[];
  outcome: AnswerOutcome;
  /** Validated catalog ids, final order. Empty unless the answer succeeded. */
  actions: string[];
  buttonSource?: "model" | "fallback" | "rules";
}

export async function runJo(o: JoRunOptions): Promise<JoResult> {
  const t = o.trace ?? (() => {});

  // 1. Route.
  const route = await routeQuestion({
    providers: o.utilityProviders,
    knowledge: o.knowledge,
    input: o.input,
    budgetMs: o.config.routerBudgetMs,
    signal: o.signal,
    log: (p, r) => {
      t("7 route", `✗ ${p} failed (${r})`);
      o.log?.(p, `route_${r}`);
    },
  });
  t(
    "7 route",
    `${route.source === "model" ? `✓ ${route.provider}` : "keyword fallback"}: intent ${route.intent}, files ${JSON.stringify(route.files)}${route.offtopic ? ", OFF-TOPIC" : ""}`,
  );
  if (route.offtopic) {
    // Declined without calling the answer model. The answer step's sentinel stays as a second layer.
    return { route, files: [], outcome: { ok: false, code: "offtopic", partial: false }, actions: [] };
  }

  // 2. Answer from the always-files plus the routed files.
  const files = filesForAnswer(o.knowledge, route);
  const system = buildSystemPrompt(renderKnowledge(o.knowledge, files));
  t("8 prompt", `always-files + ${files.length ? files.join(", ") : "nothing else"}; visitor text in tags:\n${buildUserMessage(o.input)}`);
  t("9 model", `trying ${o.answerProviders.map((p) => p.name).join(" → ")}`);
  const outcome = await generateAnswer({
    providers: o.answerProviders,
    system,
    user: buildUserMessage(o.input),
    maxTokens: o.config.maxOutputTokens,
    timeoutsMs: firstTokenTimeouts(o.answerProviders, o.config),
    totalTimeoutMs: o.config.totalTimeoutMs,
    linkAllowlist: o.linkAllowlist,
    signal: o.signal,
    onText: o.onText,
    log: (p, r) => {
      t("9 model", `✗ ${p} failed (${r}), falling through`);
      o.log?.(p, r);
    },
    trace: o.trace,
  });
  if (!outcome.ok) return { route, files, outcome, actions: [] };

  // 3. Buttons for what was asked and what Jo actually said.
  const picked = await pickButtons({
    providers: o.utilityProviders,
    knowledge: o.knowledge,
    ctx: { intent: route.intent, files: route.files, question: o.input.question, answer: outcome.text, page: o.input.page },
    budgetMs: o.config.buttonsBudgetMs,
    signal: o.signal,
    log: (p, r) => {
      t("11 buttons", `✗ ${p} failed (${r})`);
      o.log?.(p, `buttons_${r}`);
    },
  });
  t("11 buttons", `${picked.source}: ${picked.ids.length ? picked.ids.join(", ") : "none"}`);
  return { route, files, outcome, actions: picked.ids, buttonSource: picked.source };
}
