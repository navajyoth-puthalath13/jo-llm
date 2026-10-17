# Jo LLM

A tiny question-answering Worker for navajyoth.com. Visitors ask the illustrated character Jo about Navajyoth. Jo answers in first person, in a few short sentences, and only from the knowledge files in [`content/knowledge/`](content/knowledge/).

This repo is only the backend. The portfolio calls it over `fetch`.

- **Runtime:** Cloudflare Workers (free plan), Hono, Zod
- **Models** (all free tier, each with its own quota; see [The model chain](#the-model-chain)):
  - Answers: Groq `openai/gpt-oss-120b` (reasoning `medium`), then Gemini `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite`.
  - Routing and buttons: Groq `openai/gpt-oss-20b`, then Gemini, with strict structured output.
- **State:** KV holds the kill switch and the answer cache. One SQLite Durable Object holds the rate-limit counters. A Rate Limiting binding acts as a burst filter.

## API

### `GET /status`

Returns `{ "enabled": boolean }` with `Cache-Control: public, max-age=30`.

### `POST /ask`

Send it with `Content-Type: application/json` and an allowed `Origin`. The body must be under 8 KB, and unknown fields are rejected.

```json
{
  "question": "1–300 chars",
  "quote": "optional, selected text, truncated to 1000",
  "page": "optional pathname, ≤100 chars",
  "history": [{ "q": "…", "a": "…" }]
}
```

`history` keeps only the last 6 exchanges; each `q` is truncated to 300 characters and each `a` to 600. The server never stores it.

The response is `text/event-stream` and uses only these events:

| event   | data                                                                 |
| ------- | -------------------------------------------------------------------- |
| `token` | `{ "t": "text chunk" }`                                              |
| `actions` | `{ "actions": [{ "id", "label", "href", "kind": "internal" \| "external" \| "mailto" }] }` (0–3 buttons; optional) |
| `done`  | `{ "cached": boolean }`                                              |
| `error` | `{ "code": "offline" \| "rate_limited" \| "busy" \| "invalid" \| "offtopic" }` |

**Client notes**

- Always read the SSE body, even when the status is not 200. Errors raised before streaming starts come back as one `error` event with status 400, 429 or 503.
- An `error` can also arrive after some `token`s. This happens with an `offtopic` code when a leak or late sentinel is caught. Replace the bubble with the canned line instead of appending to it.
- Cached answers arrive as `token` events too, so the code path is the same. They replay their `actions` as well.
- `actions` comes after the last `token` and before `done`, only when Jo offers at least one button. It never comes with an `error`. Label, href and kind come from the catalog in `content/actions.ts`, never from the model. `internal` hrefs are paths on navajyoth.com. Old clients can ignore the event.

- A `403` with a plain-text body means the origin is not allowed. Browsers won't let you read it anyway.

## How a question flows

Each `/ask` that isn't served from the cache makes up to three model calls ([`src/jo.ts`](src/jo.ts)):

1. **Route** ([`src/route.ts`](src/route.ts)). A small structured call on `gpt-oss-20b` (Groq strict `json_schema`; Gemini `responseSchema` as fallback) returns `{ offtopic, intent, files }`:
   - `files` holds up to 3 knowledge-file ids, constrained to an enum of real ids and checked again with Zod.
   - Budget 800 ms. If the call fails or runs out of time, a deterministic keyword router uses each file's `keywords`.
   - If routing finds nothing, Jo gets every file, unless the intent is already covered by the always-included files (greetings, contact, resume, writing, private, about).
   - Off-topic questions are declined here, without calling the answer model. The answer step's `[[OFFTOPIC]]` sentinel stays as a second layer.
2. **Answer** ([`src/answer.ts`](src/answer.ts)). The system prompt is:
   - `voice` + `boundaries` + `about` + `contact` (always), then the routed files, in a stable order,
   - then short grounding rules ([`src/prompt.ts`](src/prompt.ts)).

   Streaming, the sentinel gate, the leak checks and the output sanitizer are unchanged. The answer is capped at 240 tokens; past three quarters of the cap, text is released only in whole sentences, so a capped answer ends at a full stop.
3. **Buttons** ([`src/buttons.ts`](src/buttons.ts)). A structured call gets the question, Jo's final answer, the page, the intent and the catalog (ids and `when` lines, never hrefs), and proposes ids. Budget 1 s. Then fixed rules in code decide:
   - contact → `email`, `linkedin`, `x`, in that order
   - resume → `resume` first
   - a named project → that project's button first
   - `work_overview` → `work`
   - private → `email` only, and only if the answer points to email
   - small talk → none
   - never the page the visitor is already on
   - at most 3, no duplicates

   If the call fails, the routed files' `actions` frontmatter goes through the same rules. Contact, private and small-talk questions skip the call entirely.

**Budget:** one visitor question counts as one unit of `DAILY_BUDGET`, however many calls it makes. Routing and buttons are small calls (about 1,000 and 500 tokens) on `gpt-oss-20b`, which has its own Groq quota separate from the answer model's. Cached answers cost nothing and make no calls.

**Cache:** the key covers the normalised question plus a hash of every knowledge file, the rules and the button catalog. Buttons are cached with the answer.

## The model chain

| Step | Models, in order | Settings |
|---|---|---|
| Answer (`MODELS`) | `groq:openai/gpt-oss-120b`, `gemini:gemini-3.5-flash-lite`, `gemini:gemini-3.1-flash-lite` | `ANSWER_REASONING = "medium"`; 2.5 s to the first word on Groq, 10 s on Gemini |
| Route + buttons (`UTILITY_MODELS`) | `groq:openai/gpt-oss-20b`, `gemini:gemini-3.5-flash-lite` | reasoning `low`, strict JSON schema, 800 ms and 1 s budgets |

- `gpt-oss-20b` is no longer in the answer chain, because it drifted from the facts more. It does only the small structured calls.
- A model that returns 429 is skipped for its `Retry-After` (30 s at most).
- Gemini rarely fits inside the router's 800 ms, so in practice the router falls back to keywords when Groq is busy.
- All of these are vars in `wrangler.toml`.

## Buttons (actions)

Jo can offer up to three buttons under an answer, for example "Open my resume" or "Email me". Models only ever propose ids. The server looks up the label and href in [`content/actions.ts`](content/actions.ts), so no URL ever comes from a model. See step 3 above for how they're chosen.

- **To add a button:** add an entry to `content/actions.ts` (with a clear `when`), and list its id under `actions:` in the related knowledge file.
- Every `external` and `mailto` href must pass `LINK_ALLOWLIST`, and `test/actions.test.ts` checks this.
- **Editing a label or URL** takes effect immediately, cached answers included.
- **Adding or removing an entry,** or changing its `when`, invalidates the cache.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in keys
```

Get the keys here:

- Gemini: https://aistudio.google.com/apikey
- Groq: https://console.groq.com/keys

Generate the IP salt with `openssl rand -hex 32`.

### Run it locally and watch what happens

```bash
npx wrangler kv key put --binding=JO_KV jo:enabled true --local   # local switch, separate from production
npm run dev                                   # terminal 1: server on http://localhost:8787
npm run ask -- "How did you get into design?" # terminal 2: watch the answer stream in
npm run ask -- "explain this" --quote "text selected on the page"
npm run ask -- "hi" --url https://jo-llm.navajyothputalath13.workers.dev   # the deployed Worker
```

With `JO_DEBUG=true` in `.dev.vars`, terminal 1 prints every step of each request:

```
[jo +   3ms] 1 origin   ✓ http://localhost:3000 is allowed
[jo +  14ms] 2 switch   ✓ kill switch is on
[jo +  17ms] 3 validate ✓ question "Where can I see your code?"
[jo +  26ms] 4 limits   ✓ under the per-IP limits
[jo +  28ms] 5 cache    miss: will ask a model
[jo +  29ms] 6 budget   ✓ global daily budget has room (one unit covers route + answer + buttons)
[jo + 783ms] 7 route    ✓ groq:openai/gpt-oss-20b: intent project, files ["care-scribe"]
[jo + 783ms] 8 prompt   always-files + care-scribe; visitor text in tags: …
[jo + 783ms] 9 model    trying groq:openai/gpt-oss-120b → gemini:gemini-3.5-flash-lite → …
[jo +1381ms] 9 model    groq:openai/gpt-oss-120b answered first: "No"
[jo +1439ms] 10 output  raw model text: "…"
[jo +1439ms] 10 output  sent to browser:  "…"
[jo +1940ms] 11 buttons model: care-scribe
```

`JO_DEBUG` is for local use only. Never set it in production, because it prints questions.

## Deploy

```bash
npx wrangler login
npx wrangler kv namespace create JO_KV        # paste the id into wrangler.toml
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put IP_SALT
npm run deploy                                 # prints https://jo-llm.<account>.workers.dev
npm run jo -- on                               # the switch starts OFF (fails closed)
npm run precompute                             # after any knowledge change
```

Before each deploy, check that the model names in `wrangler.toml` are still on the free tier. You can confirm that at https://ai.google.dev/gemini-api/docs/pricing and https://console.groq.com/docs/models.

Optional: add a custom domain such as `jo.navajyoth.com` under Workers → Settings → Domains & Routes.

## Kill switch

```bash
npm run jo -- off      # Jo disappears within ~30s (KV edge cache)
npm run jo -- on
npm run jo -- status
```

While the switch is off, `/status` returns `enabled: false` and `/ask` returns `offline` without calling any model. A missing key or a KV error also counts as off.

Emergency override: set `JO_FORCE_OFF = "true"`, either in the dashboard (Workers → jo-llm → Settings → Variables) or in `wrangler.toml` followed by a deploy. It wins over KV.

## Editing what Jo knows

Everything Jo knows is in [`content/knowledge/`](content/knowledge/): one small file per topic, each with frontmatter (`id`, `title`, `covers`, `keywords`, `actions`) and short fact bullets. [`content/knowledge/README.md`](content/knowledge/README.md) explains the template.

The rules:
- **One fact, one place.** Each fact lives in exactly one file.
- **`TODO:` lines are never facts.** They, comments and headings are stripped before the prompt is built.
- **Adding a new project:** create the file, then add it to `files.ts` and `index.ts`.

To change something:
1. Edit the file.
2. Run `npm test`, which checks frontmatter, unique ids and that buttons exist.
3. Optionally run `npm run eval`.
4. Deploy, then run `npm run precompute`.

The cache key covers every knowledge file, so old answers stop being served right away; they expire from KV after 7 days. Links written in the knowledge files are allowed in answers automatically. Any other link Jo may mention goes in `LINK_ALLOWLIST`, and the output filter strips every other URL and email.

## Security model

- **Origins:** only allowlisted origins get through. `/ask` without an `Origin` is rejected with 403 before any work is done. `ALLOWED_ORIGINS` entries are exact origins, or contain `*` wildcards that match letters, digits and hyphens only (never a dot), used to let the portfolio's Vercel previews in: `https://portfolio-*-navajyoth-puthalath13s-projects.vercel.app`.
- **Kill switch:** checked first. Then the body is size-capped, Zod validates it strictly, and control, zero-width and bidi characters are stripped.
- **Rate limits stop scripts, not conversations.**
  - Each visitor has a bucket of 15 questions that refills one every 6 seconds. A conversation never runs dry, and nobody is locked out for minutes; at worst a script waits 6 seconds per question.
  - A daily fairness cap of 150 per visitor stops one person from spending everyone's free quota.
  - A flood filter (10 requests per 10 s) keeps floods away from the counters.
  - A global daily budget of 2,000 model calls protects the free tiers and returns `busy` once spent. Cached answers don't count against it.
  - All of these are vars in `wrangler.toml` (`PER_IP_BURST`, `PER_IP_REFILL_SECONDS`, `PER_IP_DAILY`, `DAILY_BUDGET`).
  - IPs are hashed with a secret salt, and raw IPs are never stored or logged.
- **Prompt injection:**
  - Visitor text goes only inside `<visitor_question>`, `<selected_text>`, `<page_path>` and `<previous_exchanges>`.
  - `<` and `>` in visitor text are escaped, so it can't close those tags.
  - The rules say tag contents are data, never instructions.
  - No model has tools. Answers are capped at 240 tokens.
  - The router and button calls follow the same rules:
    - visitor text is escaped inside data tags,
    - output is strict structured JSON validated with Zod,
    - every id is checked against the knowledge files or the button catalog,
    - no URL ever comes from a model.
- **Off-topic questions:** the model replies `[[OFFTOPIC]]`. The opening tokens are held back until that's ruled out, so a decline never streams.
- **Output filtering:**
  - Markdown, HTML, and non-allowlisted links or emails are removed as the answer streams. Text is released only at word boundaries, so a URL is always seen whole.
  - If the rules marker, the sentinel or a tag name appears in the output, the answer is replaced with an `offtopic` decline.
- **Gemini:** safety filters run at Google's default `BLOCK_MEDIUM_AND_ABOVE`. `LOW` was tested and blocked harmless output. If Gemini blocks a request, it's treated as off-topic and not retried on another model.
- **Logs:** counts, latency, time to first token, provider and outcome only. Never questions, IPs or IP hashes.
- **Errors:** the browser never sees provider errors, model names or stack traces.

## Speed

- Answers stream straight from the provider. Text is held back only to check for the sentinel and to release at word boundaries.
- Routing adds about 0.5–0.8 s before the answer starts (800 ms budget). The answer's first word typically arrives about 1.4 s after the question.
- If Groq sends no first word within 2.5 s, the request is aborted and goes to Gemini.
- Buttons arrive about 0.5 s after the text, which is the button call.
- Plain questions (no quote or history) are cached in KV for 7 days. Precomputed answers to the suggested questions use no quota.

## Free-plan limits to know about

- **KV:** 1,000 writes a day. Only cache misses on plain questions write, and the global budget caps those. Keep `DAILY_BUDGET` at 1000 or below.
- **Durable Objects:** the free plan allows 100k requests a day. Each question uses about 2 requests.
- **Gemini and Groq:** free-tier RPM and RPD limits are per project or account. When the first provider errors or returns 429, requests fall through to the other one. Gemini's free tier on this key allows 15 requests a minute.

## Tests

```bash
npm test               # mocked providers, no network
npm run test:live      # opt-in: attack prompts through the real pipeline (keys in .dev.vars)
npm run test:live -- --provider=groq
npm run eval           # opt-in: 36 real questions, checks routing, facts and buttons (~12 min)
npm run eval -- --only=care-scribe --verbose
```

- The live test fails if any answer isn't a decline, or if it carries out an injected payload.
- The eval ([`test/fixtures/eval.ts`](test/fixtures/eval.ts)) checks, for each question:
  - the routed files,
  - facts the answer must contain,
  - phrases it must never contain (invented launches, dates, "real guy"…),
  - the buttons.
