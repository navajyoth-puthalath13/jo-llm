// Pre-generates answers for the suggested questions and stores them in the KV answer cache,
// so the most common questions cost no model quota and return instantly.
// Usage: npm run precompute            (uses keys from .dev.vars)
//        npm run precompute -- --dry   (print answers, write nothing)
// Re-run after every knowledge, rules or catalog change + deploy: the cache key covers all three.
import { resolveActions } from "../src/actions";
import { cacheKey } from "../src/cache";
import { answerCacheScope } from "../src/jo";
import { askLocal, config, knowledge, requireKeys, sleep } from "./local-jo";
import { kvArgs, wrangler } from "./wrangler";

export const SUGGESTED_QUESTIONS = [
  "How can I contact you?",
  "How did you get into design?",
  "What are you working on?",
  "What makes you different?",
];

requireKeys();
const dry = process.argv.includes("--dry");
const scope = answerCacheScope(knowledge);

let failed = 0;
for (const question of SUGGESTED_QUESTIONS) {
  const { outcome, actions } = await askLocal({ question });
  if (!outcome.ok) {
    console.error(`✗ ${question} → ${outcome.code}`);
    failed++;
    continue;
  }
  const shown = resolveActions(actions).map((a) => `[${a.label} → ${a.href}]`).join(" ");
  console.log(`✓ ${question}\n  ${outcome.text}  (${outcome.provider})${shown ? `\n  actions: ${shown}` : ""}`);
  if (!dry) {
    const value = JSON.stringify({ text: outcome.text, actions });
    wrangler(kvArgs("put", await cacheKey(question, scope), value, `--expiration-ttl=${config.cacheTtlSeconds}`), { capture: true });
  }
  await sleep(4000);
}
process.exit(failed ? 1 : 0);
