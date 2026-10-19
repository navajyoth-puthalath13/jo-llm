// Accuracy eval: runs test/fixtures/eval.ts through the live pipeline (route → answer → buttons)
// with the keys in .dev.vars, and prints a pass/fail table. Opt-in; not part of `npm test`.
// Usage: npm run eval [-- --only=<name>] [--delay=ms] [--verbose]
//
// Free tiers are tight (gpt-oss-120b: 8,000 tokens/min), so cases are paced, and a case that
// comes back "busy" is retried once after a pause. Expect ~10–15 minutes for the full set.
import { wordCount } from "../src/answer";
import { EVAL_CASES, MAX_EVAL_WORDS, type EvalCase } from "../test/fixtures/eval";
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
  /** Length and structure (bubble shape). */
  shape: boolean;
  problems: string[];
}

/** Length and structure checks: word ceiling, prose vs list, number of items, one line per item. */
function judgeShape(c: EvalCase, text: string, problems: string[]): boolean {
  let ok = true;
  const words = wordCount(text);
  const max = Math.min(c.maxWords ?? MAX_EVAL_WORDS, MAX_EVAL_WORDS);
  if (words > max) {
    ok = false;
    problems.push(`${words} words, max ${max}`);
  }
  const bullets = text.split("\n").filter((l) => l.startsWith("- "));
  const numbered = text.split("\n").filter((l) => /^\d+\. /.test(l));
  const isBlocks = c.input.format === "blocks";
  if (!isBlocks && /\n/.test(text)) {
    ok = false;
    problems.push("flat answer contains a line break");
  }
  if (!c.shape) {
    if (isBlocks && (bullets.length || numbered.length)) problems.push(`(note) used a list of ${bullets.length + numbered.length}`);
    return ok;
  }
  const got = bullets.length ? "bullets" : numbered.length ? "numbered" : "prose";
  if (got !== c.shape) {
    ok = false;
    problems.push(`shape ${got}, expected ${c.shape}`);
  }
  const items = c.shape === "bullets" ? bullets : c.shape === "numbered" ? numbered : [];
  if (c.items && c.shape !== "prose" && (items.length < c.items[0] || items.length > c.items[1])) {
    ok = false;
    problems.push(`${items.length} items, expected ${c.items[0]}–${c.items[1]}`);
  }
  for (const item of items) {
    if (wordCount(item.replace(/^(?:- |\d+\. )/, "")) > 12) {
      ok = false;
      problems.push(`item too long: ${JSON.stringify(item)}`);
    }
  }
  return ok;
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
    return { route: null, content: ok, buttons: r.actions.length === 0, shape: true, problems };
  }
  if (!r.outcome.ok && c.declineOk && r.outcome.code === "offtopic" && !r.actions.length) {
    return { route: null, content: true, buttons: true, shape: true, problems };
  }
  if (!r.outcome.ok) {
    problems.push(`no answer: ${r.outcome.code}${r.route.offtopic ? " (router said off-topic)" : ""}`);
    return { route: r.route.source === "model" ? false : null, content: false, buttons: false, shape: false, problems };
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
  const shape = judgeShape(c, text, problems);
  return { route, content, buttons, shape, problems };
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
  const pass = v.content && v.buttons && v.shape && v.route !== false;
  const words = r.outcome.ok ? wordCount(r.outcome.text) : 0;
  console.log(
    `${pass ? "PASS" : "FAIL"}  route ${mark(v.route)}  facts ${mark(v.content)}  buttons ${mark(v.buttons)}  shape ${mark(v.shape)}  ${String(words).padStart(3)}w ${String(r.ms).padStart(5)}ms  ${c.name}`,
  );
  if (!pass || verbose) {
    const answer = r.outcome.ok ? r.outcome.text : `(${r.outcome.code})`;
    console.log(
      `      route: ${r.route.source} ${r.route.intent} ${JSON.stringify(r.route.files)} | answered by: ${r.outcome.ok ? r.outcome.provider : "-"} | buttons: ${JSON.stringify(r.actions)} (${r.buttonSource ?? "-"})`,
    );
    console.log(`      answer: ${JSON.stringify(answer)}`);
    for (const p of v.problems) console.log(`      ✗ ${p}`);
  }
  if (i < cases.length - 1) await sleep(delayMs);
}

const passed = rows.filter((x) => x.v.content && x.v.buttons && x.v.shape && x.v.route !== false).length;
const routeJudged = rows.filter((x) => x.v.route !== null);
const fallbacks = rows.filter((x) => x.r.route.source === "keywords").length;
console.log(`\n${passed}/${rows.length} passed`);
console.log(`routing: ${routeJudged.filter((x) => x.v.route).length}/${routeJudged.length} correct (model), ${fallbacks} used the keyword fallback`);
console.log(`facts: ${rows.filter((x) => x.v.content).length}/${rows.length}   buttons: ${rows.filter((x) => x.v.buttons).length}/${rows.length}   shape: ${rows.filter((x) => x.v.shape).length}/${rows.length}`);
process.exit(passed === rows.length ? 0 : 1);
