// Ask Jo from the terminal and watch the answer stream in, with timings.
// Usage:
//   npm run ask -- "How did you get into design?"
//   npm run ask -- "explain this" --quote "some text from the page"
//   npm run ask -- "hi" --url https://jo-llm.navajyothputalath13.workers.dev   (deployed Worker)
import { readSseData } from "../src/sse";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const url = flag("url") ?? "http://localhost:8787";
const quote = flag("quote");
const page = flag("page");
const origin = flag("origin") ?? (url.includes("localhost") ? "http://localhost:3000" : "https://navajyoth.com");
const question = args.join(" ").trim();
if (!question) {
  console.error('Usage: npm run ask -- "your question" [--quote "selected text"] [--url http://localhost:8787]');
  process.exit(1);
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const started = Date.now();
const ms = () => dim(`+${Date.now() - started}ms`);

console.log(dim(`POST ${url}/ask  (Origin: ${origin})`));
let res: Response;
try {
  res = await fetch(`${url}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ question, ...(quote ? { quote } : {}), ...(page ? { page } : {}) }),
  });
} catch {
  console.error(`Couldn't reach ${url}. Is the local server running? (npm run dev)`);
  process.exit(1);
}
console.log(dim(`HTTP ${res.status} ${ms()}`));
if (res.status === 403) {
  console.log("403: origin not allowed (check ALLOWED_ORIGINS).");
  process.exit(1);
}

let first = true;
let answer = "";
let currentEvent = "";
// Events are told apart by their data: token has "t", done has "cached", error has "code".
for await (const data of readSseData(res.body!)) {
  const d = JSON.parse(data) as { t?: string; cached?: boolean; code?: string };
  if (d.t !== undefined) {
    if (first) {
      process.stdout.write(`${dim(`first word ${ms()}`)}\n\nJo: `);
      first = false;
    }
    answer += d.t;
    process.stdout.write(d.t);
  } else if (d.cached !== undefined) {
    currentEvent = "done";
    console.log(`\n\n${dim(`done ${ms()}  cached=${d.cached}`)}`);
  } else if (d.code) {
    currentEvent = "error";
    const lines: Record<string, string> = {
      offline: "I'm away from my desk right now — drop me an email?",
      rate_limited: "Phew, lots of questions! Give me a few seconds.",
      busy: "I'm a little overloaded today — email me and I'll reply properly.",
      offtopic: "Ha, I only really know about me. Ask me about my work?",
      invalid: "I didn't catch that — try again?",
    };
    console.log(`${answer ? "\n" : ""}\nerror "${d.code}" ${ms()}\nThe site would show: "${lines[d.code] ?? lines.invalid}"`);
  }
}
if (!currentEvent) console.log(dim("\n(stream ended without done/error)"));
