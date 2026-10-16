// Pre-generates answers for the suggested questions and stores them in the KV answer cache,
// so the most common questions cost no model quota and return instantly.
// Usage: npm run precompute            (uses keys from .dev.vars)
//        npm run precompute -- --dry   (print answers, write nothing)
// Re-run after every jo.md or prompt edit + deploy: the cache key includes the prompt's hash.
import { generateAnswer } from "../src/answer";
import { cacheKey } from "../src/cache";
import { loadConfig } from "../src/config";
import { linksFromKnowledge } from "../src/guard/output";
import { defaultProviders } from "../src/providers/router";
import { buildSystemPrompt, buildUserMessage } from "../src/prompt";
import { kvArgs, readDevVars, readJoMd, wrangler } from "./wrangler";

export const SUGGESTED_QUESTIONS = [
  "How can I contact you?",
  "How did you get into design?",
  "What are you working on?",
  "What makes you different?",
];

const dry = process.argv.includes("--dry");
const joMd = readJoMd();
if (/^\s*TODO:/m.test(joMd)) {
  console.error("content/jo.md still has TODO: lines. Fill it in before precomputing.");
  process.exit(1);
}

const config = loadConfig({ ...readDevVars(), ...process.env } as never);
const providers = defaultProviders(config);
if (!providers.length) {
  console.error("No provider keys. Put GEMINI_API_KEY and/or GROQ_API_KEY in .dev.vars.");
  process.exit(1);
}
const system = buildSystemPrompt(joMd);

let failed = 0;
for (const question of SUGGESTED_QUESTIONS) {
  const outcome = await generateAnswer({
    providers,
    system,
    user: buildUserMessage({ question }),
    maxTokens: config.maxOutputTokens,
    timeoutsMs: [15000, 15000],
    totalTimeoutMs: 30000,
    linkAllowlist: [...config.linkAllowlist, ...linksFromKnowledge(joMd)],
    signal: new AbortController().signal,
    onText: async () => {},
  });
  if (!outcome.ok) {
    console.error(`✗ ${question} → ${outcome.code}`);
    failed++;
    continue;
  }
  console.log(`✓ ${question}\n  ${outcome.text}  (${outcome.provider})`);
  if (!dry) {
    const key = await cacheKey(question, system);
    wrangler(kvArgs("put", key, outcome.text, `--expiration-ttl=${config.cacheTtlSeconds}`), { capture: true });
  }
}
process.exit(failed ? 1 : 0);
