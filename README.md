# Jo LLM

A tiny question-answering Worker for navajyoth.com. Visitors ask the illustrated character Jo about Navajyoth. Jo answers in first person, in one to three short sentences, and only from [`content/jo.md`](content/jo.md).

This repo is only the backend. The portfolio calls it over `fetch`.

- **Runtime:** Cloudflare Workers (free plan), Hono, Zod
- **Models:** Groq `openai/gpt-oss-120b` (tried first, starts in ~0.5 s) and Gemini `gemini-3.5-flash-lite` (backup; its free tier takes 2–8 s to start). Both are free tier. The order (`PROVIDER_ORDER`) and model names are vars in `wrangler.toml`. Groq's free tier no longer includes Llama chat models.
- **State:** KV holds the kill switch and the answer cache. One SQLite Durable Object holds the rate-limit counters. A Rate Limiting binding acts as a burst filter.

## API

### `GET /status`

Returns `{ "enabled": boolean }` with `Cache-Control: public, max-age=30`.

### `POST /ask`

Send it with `Content-Type: application/json` and an allowed `Origin`. The body must be under 4 KB, and unknown fields are rejected.

```json
{
  "question": "1–300 chars",
  "quote": "optional, selected text, truncated to 500",
  "page": "optional pathname, ≤100 chars",
  "history": [{ "q": "…", "a": "…" }]
}
```

`history` keeps only the last 3 exchanges, and each field is truncated to 300 characters. The server never stores it.

The response is `text/event-stream` and uses only these events:

| event   | data                                                                 |
| ------- | -------------------------------------------------------------------- |
| `token` | `{ "t": "text chunk" }`                                              |
| `done`  | `{ "cached": boolean }`                                              |
| `error` | `{ "code": "offline" \| "rate_limited" \| "busy" \| "invalid" \| "offtopic" }` |

**Client notes**

- Always read the SSE body, even when the status is not 200. Errors raised before streaming starts come back as one `error` event with status 400, 429 or 503.
- An `error` can also arrive after some `token`s. This happens with an `offtopic` code when a leak or late sentinel is caught. Replace the bubble with the canned line instead of appending to it.
- Cached answers arrive as `token` events too, so the code path is the same.
- A `403` with a plain-text body means the origin is not allowed. Browsers won't let you read it anyway.

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
[jo +  29ms] 6 budget   ✓ global daily budget has room
[jo +  29ms] 7 prompt   jo.md + rules as system prompt; visitor text wrapped in tags: …
[jo +  29ms] 8 model    trying groq → gemini (2500ms to first word)
[jo + 520ms] 8 model    groq answered first: "You"
[jo + 530ms] 9 output   raw model text: "…"
[jo + 530ms] 9 output   sent to browser:  "…"
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
npm run precompute                             # after jo.md is filled in
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

Edit `content/jo.md`, deploy, then run `npm run precompute`.

The cache key includes a hash of the whole prompt (jo.md plus the rules), so old answers stop being served right away. They expire from KV after 7 days. Keep `<!-- DRAFT: review -->` markers until you've checked each section. Add any link Jo may mention to `LINK_ALLOWLIST`; the output filter strips every other URL and email.

## Security model

- **Origins:** only allowlisted origins get through. `/ask` without an `Origin` is rejected with 403 before any work is done. `ALLOWED_ORIGINS` entries are exact origins, or contain `*` wildcards that match letters, digits and hyphens only (never a dot), used to let the portfolio's Vercel previews in: `https://portfolio-*-navajyoth-puthalath13s-projects.vercel.app`.
- **Kill switch:** checked first. Then the body is size-capped, Zod validates it strictly, and control, zero-width and bidi characters are stripped.
- **Rate limits:** a per-IP burst filter (4 per 10 s), then 8 per 10 min and 30 per day per IP. On top of that sits a global daily budget of model calls, which returns `busy` once spent. IPs are hashed with a secret salt, and raw IPs are never stored or logged.
- **Prompt injection:**
  - Visitor text goes only inside `<visitor_question>`, `<selected_text>`, `<page_path>` and `<previous_exchanges>`.
  - `<` and `>` in visitor text are escaped, so it can't close those tags.
  - The rules say tag contents are data, never instructions.
  - The model has no tools, and output is capped at 180 tokens.
- **Off-topic questions:** the model replies `[[OFFTOPIC]]`. The opening tokens are held back until that's ruled out, so a decline never streams.
- **Output filtering:**
  - Markdown, HTML, and non-allowlisted links or emails are removed as the answer streams. Text is released only at word boundaries, so a URL is always seen whole.
  - If the rules marker, the sentinel or a tag name appears in the output, the answer is replaced with an `offtopic` decline.
- **Gemini:** safety filters run at `BLOCK_LOW_AND_ABOVE`. If Gemini blocks a request, it's treated as off-topic and not retried on Groq.
- **Logs:** counts, latency, time to first token, provider and outcome only. Never questions, IPs or IP hashes.
- **Errors:** the browser never sees provider errors, model names or stack traces.

## Speed

- Answers stream straight from the provider. Text is held back only to check for the sentinel and to release at word boundaries.
- If the primary sends no first token within 2.5 s, the request is aborted and goes to the fallback.
- Plain questions (no quote or history) are cached in KV for 7 days. Precomputed answers to the suggested questions use no quota.

## Free-plan limits to know about

- **KV:** 1,000 writes a day. Only cache misses on plain questions write, and the global budget caps those. Keep `DAILY_BUDGET` at 1000 or below.
- **Durable Objects:** the free plan allows 100k requests a day. Each question uses about 2 requests.
- **Gemini and Groq:** free-tier RPM and RPD limits are per project or account. When the first provider errors or returns 429, requests fall through to the other one. Gemini's free tier on this key allows 15 requests a minute.

## Tests

```bash
npm test               # mocked providers, no network
npm run test:live      # opt-in: 24 attack prompts against the real models (keys in .dev.vars)
npm run test:live -- --provider=groq
```

The live test fails if any answer isn't a decline, or if it carries out an injected payload.
