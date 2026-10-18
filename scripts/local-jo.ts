// Runs Jo's real pipeline (route → answer → buttons) from Node, with keys from .dev.vars and the
// knowledge files read from disk. Shared by the eval, live-check and precompute scripts.
import { loadConfig, type Config } from "../src/config";
import { linksFromKnowledge } from "../src/guard/output";
import type { AskInput } from "../src/guard/validate";
import { runJo, type JoResult } from "../src/jo";
import { allFacts, buildKnowledge } from "../src/knowledge";
import { defaultProviders, utilityProviders } from "../src/providers/router";
import type { Provider } from "../src/providers/types";
import { forwardUsage, recordingProviders, type UsageEvent } from "../src/usage";
import { readDevVars, readKnowledgeSources } from "./wrangler";

export const config: Config = loadConfig({ ...readDevVars(), ...process.env } as never);
export const knowledge = buildKnowledge(readKnowledgeSources());
const linkAllowlist = [...config.linkAllowlist, ...linksFromKnowledge(allFacts(knowledge))];

export function requireKeys(): Provider[] {
  const answer = defaultProviders(config);
  if (!answer.length) {
    console.error("No provider keys. Put GEMINI_API_KEY and/or GROQ_API_KEY in .dev.vars.");
    process.exit(1);
  }
  return answer;
}

export interface LocalRun extends JoResult {
  ms: number;
}

/** One question through the production pipeline. Pass `answerProviders` to pin one model. */
export async function askLocal(
  input: AskInput,
  opts: { answerProviders?: Provider[]; trace?: (step: string, detail: string) => void } = {},
): Promise<LocalRun> {
  const started = Date.now();
  // Every call made with these keys is counted on the live usage page, if .dev.vars says where.
  const events: UsageEvent[] = [];
  const record = (e: UsageEvent) => void events.push(e);
  const result = await runJo({
    input,
    knowledge,
    answerProviders: recordingProviders(opts.answerProviders ?? defaultProviders(config), record),
    utilityProviders: recordingProviders(utilityProviders(config), record),
    config,
    linkAllowlist,
    signal: new AbortController().signal,
    onText: async () => {},
    trace: opts.trace,
  });
  await forwardUsage(config.usageForwardUrl, config.usageForwardToken, events);
  return { ...result, ms: Date.now() - started };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
