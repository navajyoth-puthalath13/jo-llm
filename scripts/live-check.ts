// Opt-in live test: runs every attack fixture against the real models and fails if any answer
// is not a decline (or contains a forbidden payload). Uses keys from .dev.vars. Costs ~25 calls.
// Usage: npm run test:live
import { generateAnswer } from "../src/answer";
import { loadConfig } from "../src/config";
import { linksFromKnowledge } from "../src/guard/output";
import { buildSystemPrompt, buildUserMessage } from "../src/prompt";
import { defaultProviders } from "../src/providers/router";
import type { Provider } from "../src/providers/types";
import { ATTACKS } from "../test/fixtures/injection";
import { ACTION_EXPECTATIONS } from "../test/fixtures/actions";
import { readDevVars, readJoMd } from "./wrangler";

const config = loadConfig({ ...readDevVars(), ...process.env } as never);
const all = defaultProviders(config);
if (!all.length) {
  console.error("No provider keys. Put GEMINI_API_KEY and/or GROQ_API_KEY in .dev.vars.");
  process.exit(1);
}
const joMd = readJoMd();
const system = buildSystemPrompt(joMd);

// Test each provider on its own: the fallback must be just as safe as the primary.
// --provider=groq (every Groq model) or --provider=groq:openai/gpt-oss-20b (one model).
const only = process.argv.find((a) => a.startsWith("--provider="))?.slice("--provider=".length);
const targets = all.filter((p) => !only || p.name === only || p.name.startsWith(`${only}:`));
// Free tiers are tight (Gemini Flash-Lite: 15 requests/minute), so pace requests. Override with --delay=ms.
const delayMs = Number(process.argv.find((a) => a.startsWith("--delay="))?.split("=")[1] ?? 4500);

const ask = (provider: Provider, input: Parameters<typeof buildUserMessage>[0]) =>
  generateAnswer({
    providers: [provider],
    system,
    user: buildUserMessage(input),
    maxTokens: config.maxOutputTokens,
    timeoutsMs: [15000],
    totalTimeoutMs: 30000,
    linkAllowlist: [...config.linkAllowlist, ...linksFromKnowledge(joMd)],
    signal: new AbortController().signal,
    onText: async () => {},
    log: (name, result) => console.log(`  (${name}: ${result})`),
  });

let failures = 0;
for (const provider of targets) {
  console.log(`\n== ${provider.name} ==`);
  const filter = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  for (const attack of ATTACKS.filter((a) => !filter || a.name.includes(filter))) {
    const outcome = await ask(provider, attack.input);
    let pass: boolean;
    let detail: string;
    if (!outcome.ok) {
      pass = outcome.code === "offtopic";
      detail = outcome.code;
    } else {
      // Only fixtures with a `forbidden` pattern may produce a real answer.
      pass = !!attack.forbidden && !attack.forbidden.test(outcome.text);
      detail = `${outcome.text}${outcome.actions.length ? `  [actions: ${outcome.actions.join(", ")}]` : ""}`;
    }
    if (!pass) failures++;
    console.log(`${pass ? "✓" : "✗"} ${attack.name}: ${detail}`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // Buttons: the right action for navigation questions, and none on declines.
  const actionFilter = process.argv.find((a) => a.startsWith("--actions-only="))?.split("=")[1];
  for (const check of ACTION_EXPECTATIONS.filter((c) => !actionFilter || c.name.includes(actionFilter))) {
    const outcome = await ask(provider, check.input);
    const pass =
      check.expect === "decline"
        ? !outcome.ok && outcome.code === "offtopic"
        : outcome.ok && outcome.actions.includes(check.expect);
    if (!pass) failures++;
    const detail = outcome.ok ? `${outcome.text}  [actions: ${outcome.actions.join(", ") || "none"}]` : outcome.code;
    console.log(`${pass ? "✓" : "✗"} action/${check.name} (expects ${check.expect}): ${detail}`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
}
console.log(failures ? `\n${failures} failure(s)` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
