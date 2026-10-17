// Accuracy eval: runs test/fixtures/eval.ts through the live pipeline (route → answer → buttons)
// with the keys in .dev.vars, and prints a pass/fail table. Opt-in; not part of `npm test`.
// Usage: npm run eval [-- --only=<name>] [--delay=ms] [--verbose]
//
// Free tiers are tight (gpt-oss-120b: 8,000 tokens/min), so cases are paced, and a case that
// comes back "busy" is retried once after a pause. Expect ~10–15 minutes for the full set.
import { EVAL_CASES, type EvalCase } from "../test/fixtures/eval";
import { askLocal, requireKeys, sleep, type LocalRun } from "./local-jo";

requireKeys();
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const only = arg("only");
const delayMs = Number(arg("delay") ?? 15000);
const verbose = process.argv.includes("--verbose");

interface Verdict {
  route: boolean | null; // null: keyword fallback, not judged
  content: boolean;
  buttons: boolean;
  problems: string[];
}

const lower = (s: string) => s.toLowerCase();
const matches = (text: string, alt: string | string[]) =>
  (Array.isArray(alt) ? alt : [alt]).some((a) => lower(text).includes(lower(a)));

function judge(c: EvalCase, r: LocalRun): Verdict {
  const problems: string[] = [];
  const text = r.outcome.ok ? r.outcome.text : "";

  if (c.decline) {
    const ok = !r.outcome.ok && r.outcome.code === "offtopic" && r.actions.length === 0;
    if (!ok) problems.push(`expected a decline, got ${r.outcome.ok ? `"${text}"` : r.outcome.code}`);
    return { route: null, content: ok, buttons: r.actions.length === 0, problems };
  }
  if (!r.outcome.ok && c.declineOk && r.outcome.code === "offtopic" && !r.actions.length) {
    return { route: null, content: true, buttons: true, problems };
  }
  if (!r.outcome.ok) {
    problems.push(`no answer: ${r.outcome.code}${r.route.offtopic ? " (router said off-topic)" : ""}`);
    return { route: r.route.source === "model" ? false : null, content: false, buttons: false, problems };
  }

  let route: boolean | null = null;
  if (c.files && r.route.source === "model") {
    route = c.files.every((f) => r.route.files.includes(f));
    if (!route) problems.push(`routed ${JSON.stringify(r.route.files)}, expected ${JSON.stringify(c.files)}`);
  }

  let content = true;
  for (const want of c.contains ?? []) {
    if (!matches(text, want)) {
      content = false;
      problems.push(`missing ${JSON.stringify(want)}`);
    }
  }
  for (const bad of c.never ?? []) {
    const hit = typeof bad === "string" ? lower(text).includes(lower(bad)) : bad.test(text);
    if (hit) {
      content = false;
      problems.push(`contains forbidden ${String(bad)}`);
    }
  }

  let buttons = true;
  if (c.buttons) {
    buttons = c.exactButtons
      ? JSON.stringify(r.actions) === JSON.stringify(c.buttons)
      : c.buttons.every((b) => r.actions.includes(b));
    if (!buttons) problems.push(`buttons ${JSON.stringify(r.actions)}, expected ${c.exactButtons ? "exactly " : ""}${JSON.stringify(c.buttons)}`);
  }
  const unwanted = (c.notButtons ?? []).filter((b) => r.actions.includes(b));
  if (unwanted.length) {
    buttons = false;
    problems.push(`buttons ${JSON.stringify(r.actions)} must not include ${JSON.stringify(unwanted)}`);
  }
  return { route, content, buttons, problems };
}

const cases = EVAL_CASES.filter((c) => !only || c.name.includes(only));
const rows: { c: EvalCase; r: LocalRun; v: Verdict }[] = [];
const mark = (b: boolean | null) => (b === null ? "–" : b ? "✓" : "✗");

console.log(`Running ${cases.length} cases (pace ${delayMs / 1000}s)…\n`);
for (const [i, c] of cases.entries()) {
  let r = await askLocal(c.input);
  if (!r.outcome.ok && r.outcome.code === "busy") {
    console.log(`  (${c.name}: busy, retrying in 60s)`);
    await sleep(60_000);
    r = await askLocal(c.input);
  }
  const v = judge(c, r);
  rows.push({ c, r, v });
  const pass = v.content && v.buttons && v.route !== false;
  console.log(
    `${pass ? "PASS" : "FAIL"}  route ${mark(v.route)}  facts ${mark(v.content)}  buttons ${mark(v.buttons)}  ${String(r.ms).padStart(5)}ms  ${c.name}`,
  );
  if (!pass || verbose) {
    const answer = r.outcome.ok ? r.outcome.text : `(${r.outcome.code})`;
    console.log(
      `      route: ${r.route.source} ${r.route.intent} ${JSON.stringify(r.route.files)} | answered by: ${r.outcome.ok ? r.outcome.provider : "-"} | buttons: ${JSON.stringify(r.actions)} (${r.buttonSource ?? "-"})`,
    );
    console.log(`      answer: ${answer}`);
    for (const p of v.problems) console.log(`      ✗ ${p}`);
  }
  if (i < cases.length - 1) await sleep(delayMs);
}

const passed = rows.filter((x) => x.v.content && x.v.buttons && x.v.route !== false).length;
const routeJudged = rows.filter((x) => x.v.route !== null);
const fallbacks = rows.filter((x) => x.r.route.source === "keywords").length;
console.log(`\n${passed}/${rows.length} passed`);
console.log(`routing: ${routeJudged.filter((x) => x.v.route).length}/${routeJudged.length} correct (model), ${fallbacks} used the keyword fallback`);
console.log(`facts: ${rows.filter((x) => x.v.content).length}/${rows.length}   buttons: ${rows.filter((x) => x.v.buttons).length}/${rows.length}`);
process.exit(passed === rows.length ? 0 : 1);
