// Opt-in live test: runs every attack fixture through the real pipeline and fails if any answer
// is not a decline (or carries out an injected payload), then checks buttons on navigation
// questions. Uses keys from .dev.vars.
// Usage: npm run test:live [-- --provider=groq] [--only=<name>] [--delay=ms]
import type { AskInput } from "../src/guard/validate";
import { ACTION_EXPECTATIONS } from "../test/fixtures/actions";
import { ATTACKS } from "../test/fixtures/injection";
import { askLocal, requireKeys, sleep } from "./local-jo";

const all = requireKeys();
// Test each answer model on its own: every model in the chain must be just as safe.
// --provider=groq (every Groq model) or --provider=groq:openai/gpt-oss-120b (one model).
const only = process.argv.find((a) => a.startsWith("--provider="))?.slice("--provider=".length);
const targets = all.filter((p) => !only || p.name === only || p.name.startsWith(`${only}:`));
const delayMs = Number(process.argv.find((a) => a.startsWith("--delay="))?.split("=")[1] ?? 8000);
const filter = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

let failures = 0;
for (const provider of targets) {
  console.log(`\n== ${provider.name} ==`);
  const ask = (input: AskInput) => askLocal(input, { answerProviders: [provider] });

  for (const attack of ATTACKS.filter((a) => !filter || a.name.includes(filter))) {
    const { outcome, route } = await ask(attack.input);
    let pass: boolean;
    let detail: string;
    if (!outcome.ok) {
      pass = outcome.code === "offtopic";
      detail = `${outcome.code}${route.offtopic ? " (router)" : ""}`;
    } else {
      // Only fixtures with a `forbidden` pattern may produce a real answer.
      pass = !!attack.forbidden && !attack.forbidden.test(outcome.text);
      detail = outcome.text;
    }
    if (!pass) failures++;
    console.log(`${pass ? "✓" : "✗"} ${attack.name}: ${detail}`);
    await sleep(delayMs);
  }

  const actionFilter = process.argv.find((a) => a.startsWith("--actions-only="))?.split("=")[1];
  for (const check of ACTION_EXPECTATIONS.filter((c) => !actionFilter || c.name.includes(actionFilter))) {
    const { outcome, actions } = await ask(check.input);
    const pass =
      check.expect === "decline" ? !outcome.ok && outcome.code === "offtopic" && !actions.length : outcome.ok && actions.includes(check.expect);
    if (!pass) failures++;
    const detail = outcome.ok ? `${outcome.text}  [actions: ${actions.join(", ") || "none"}]` : outcome.code;
    console.log(`${pass ? "✓" : "✗"} action/${check.name} (expects ${check.expect}): ${detail}`);
    await sleep(delayMs);
  }
}
console.log(failures ? `\n${failures} failure(s)` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
