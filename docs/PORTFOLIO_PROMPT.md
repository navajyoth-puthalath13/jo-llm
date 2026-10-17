# Prompt: connect the portfolio to Jo LLM

Paste everything below the line into a Claude Code session opened in the portfolio repo
(`navajyoth-puthalath13/Portfolio`).

---

Read `CLAUDE.md`, `PORTFOLIO_ARCHITECTURE.md` and `DESIGN_GUIDELINES.md` first and follow them. Then add the "Ask Jo" interaction: visitors ask the illustrated Jo questions about me, and Jo answers in a speech bubble above his head. There is no chat window and no chatbot UI.

All the AI work happens in a separate backend that is already built and deployed: **Jo LLM**, a Cloudflare Worker (repo `navajyoth-puthalath13/jo-llm`). The portfolio only calls it over `fetch`. Never put API keys, prompts or model names in this repo.

## 1. The backend you are talking to

- Production URL: `https://jo-llm.navajyothputalath13.workers.dev`
- Local URL when I run the backend with `npm run dev` in the jo-llm repo: `http://localhost:8787`
- Allowed origins: `https://navajyoth.com`, `https://www.navajyoth.com`, and `http://localhost:3000` in local dev. Any other origin gets a `403` before any work is done. That includes Vercel preview URLs, unless I add them to `ALLOWED_ORIGINS` in the jo-llm repo.

### `GET /status`

Returns `{ "enabled": boolean }` and is cached for 30 seconds. This is the kill switch. Call it once, lazily (see Loading), and if `enabled` is false, hide the whole feature: no shortcut, no hint, no selection button. If it errors, treat it as disabled.

### `POST /ask`

Headers: `Content-Type: application/json`. The browser adds `Origin` automatically. Body:

```json
{
  "question": "1–300 chars, required",
  "quote": "optional, the text the visitor selected, max 1000 chars (truncate client-side)",
  "page": "optional, location.pathname, max 100 chars",
  "history": [{ "q": "…", "a": "…" }]
}
```

- `history` holds the last 6 exchanges at most, with each `q` truncated to 300 chars and each `a` to 600. The server never stores it.
- Send no other fields. Unknown fields are rejected as `invalid`.
- The whole body must stay under 8 KB.

The response is `text/event-stream` (Server-Sent Events) with exactly these events:

| event   | data                                   | meaning                                 |
| ------- | -------------------------------------- | --------------------------------------- |
| `token` | `{ "t": "text chunk" }`                | append to the bubble                    |
| `actions` | `{ "actions": [{ "id": "resume", "label": "Open my resume", "href": "https://…", "kind": "external" }] }` | 0–4 buttons to show under the answer (optional; usually 1, and up to 4 for "how can I reach you": Email me, Connect on LinkedIn, Find me on X, Read my Substack). Make sure 4 fit, wrapping if needed |
| `done`  | `{ "cached": boolean }`                | the answer is complete                  |
| `error` | `{ "code": "offline" \| "rate_limited" \| "busy" \| "invalid" \| "offtopic" }` | replace the bubble text with the matching line below |

Rules the client must follow:

1. **Always read the SSE body, even when the HTTP status is not 200.** Errors that happen before streaming come back as a single `error` event, with status `400` (`invalid`), `429` (`rate_limited`) or `503` (`offline`/`busy`). Do not branch on `res.ok`.
2. **An `error` can arrive after some `token`s.** For example, Jo started answering and the server caught something it must not say. When that happens, *replace* the bubble's text with the in-character line. Never append to it.
3. Cached answers also arrive as `token` events (and replay their `actions`), so there is only one code path.
4. A network failure, a `403`, or a stream that ends without `done` or `error` counts as `invalid`.
5. Abort the request (`AbortController`) on Escape, and whenever a new question is asked.
6. `actions` arrives after the last `token` and before `done`, only when there's at least one button. It never comes with an `error`. If an `error` replaces the answer, show no buttons. Render each as a small button under the bubble text with the given `label`:
   - `internal`: a same-tab link to that path on navajyoth.com (`/#work`, `/work/care-scribe`). Use `next/link`, and scroll for `/#…` anchors.
   - `external`: open in a new tab with `rel="noopener noreferrer"`.
   - `mailto`: a normal `mailto:` link.
   - The server already validated everything, but still only render `http(s):`, `mailto:` and `/` hrefs as a second guard.

### In-character lines for error codes

- `offline`: "I'm away from my desk right now — drop me an email?"
- `rate_limited`: "Phew, lots of questions! Give me a few seconds."
- `busy`: "I'm a little overloaded today — email me and I'll reply properly."
- `offtopic`: "Ha, I only really know about me. Ask me about my work?"
- `invalid` or any network error: "I didn't catch that — try again?"

Limits (the server enforces them; just show the line): each visitor can ask 15 questions in a quick burst, then one every 6 seconds, up to 150 a day. A real conversation never meets them, so `rate_limited` should be rare and short-lived.

### Reference SSE client (`lib/joLlm.ts`)

Use this as the starting point and adapt it to the repo's conventions:

```ts
export type JoErrorCode = "offline" | "rate_limited" | "busy" | "invalid" | "offtopic";
export interface JoExchange { q: string; a: string }

export const JO_LLM_URL = process.env.NEXT_PUBLIC_JO_LLM_URL ?? "";
export const JO_LLM_ENABLED = process.env.NEXT_PUBLIC_JO_LLM_ENABLED === "true" && !!JO_LLM_URL;

export const JO_ERROR_LINES: Record<JoErrorCode, string> = {
  offline: "I'm away from my desk right now — drop me an email?",
  rate_limited: "Phew, lots of questions! Give me a few seconds.",
  busy: "I'm a little overloaded today — email me and I'll reply properly.",
  offtopic: "Ha, I only really know about me. Ask me about my work?",
  invalid: "I didn't catch that — try again?",
};

let statusPromise: Promise<boolean> | null = null;
/** One /status call per page load. Any failure means "disabled". */
export function checkJoStatus(): Promise<boolean> {
  if (!JO_LLM_ENABLED) return Promise.resolve(false);
  statusPromise ??= fetch(`${JO_LLM_URL}/status`)
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .then((d: { enabled?: boolean }) => d.enabled === true)
    .catch(() => false);
  return statusPromise;
}

export interface JoAction {
  id: string;
  label: string;
  href: string;
  kind: "internal" | "external" | "mailto";
}

export interface AskHandlers {
  onToken: (text: string) => void;
  onActions: (actions: JoAction[]) => void;
  onDone: (cached: boolean) => void;
  onError: (code: JoErrorCode) => void;
}

export async function askJo(
  body: { question: string; quote?: string; page?: string; history?: JoExchange[] },
  handlers: AskHandlers,
  signal: AbortSignal,
): Promise<void> {
  const clip = (s: string, n: number) => s.slice(0, n);
  const payload = {
    question: clip(body.question.trim(), 300),
    ...(body.quote ? { quote: clip(body.quote, 1000) } : {}),
    ...(body.page ? { page: clip(body.page, 100) } : {}),
    ...(body.history?.length
      ? { history: body.history.slice(-6).map((h) => ({ q: clip(h.q, 300), a: clip(h.a, 600) })) }
      : {}),
  };
  let finished = false;
  try {
    const res = await fetch(`${JO_LLM_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.body || res.status === 403) return handlers.onError("invalid");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "{}");
        if (event === "token") handlers.onToken(data.t);
        else if (event === "actions") handlers.onActions(data.actions);
        else if (event === "done") { finished = true; handlers.onDone(data.cached); }
        else if (event === "error") { finished = true; handlers.onError(data.code); }
      }
    }
    if (!finished) handlers.onError("invalid");
  } catch {
    if (!signal.aborted) handlers.onError("invalid");
  }
}
```

## 2. Behaviour

- **Hero:** pressing `/` or `⌘/` (`Ctrl /` on Windows) opens a Figma-style cursor-chat pill at the mouse position, with the placeholder "Ask me anything…" and styled like Figma's cursor chat. While the visitor types, Jo (`components/Hero/JoCharacter.tsx`) switches to a listening pose: head up, reusing sprite frame 2 ("looks up at the visitor"). Enter sends. The pill stays briefly showing the question, then fades. Jo's answer streams word by word into a speech bubble above his head. Escape closes everything and aborts the request.
- **Other pages** (case studies, about, blog): pressing `/` brings a standing Jo into a fixed bottom corner, then the same pill and bubble flow. He leaves a few seconds after the bubble closes. The standing illustration will be supplied later as a sprite, so use a clearly marked placeholder until then.
- **Text selection anywhere:** a small "Ask Jo" button appears above the selection. Clicking it brings Jo in, and he answers about that passage directly. Send it as `quote`, with the question "explain this".
- **Follow-ups:** pressing `/` while an answer is showing opens a new pill as a follow-up. Send the last 6 exchanges as `history`.
- Ignore `/` while focus is in an input, textarea or contenteditable. Call `preventDefault` so Firefox quick find doesn't open.
- Show a subtle "press / to ask me" hint near Jo in the hero. On touch devices, tapping Jo opens the pill. Tapping already replays the greeting today, so decide how the two coexist (for example, the first tap greets and opens the pill).
- Fit in with the existing custom cursor (`components/Cursor/Cursor.tsx`) and the intro cursor tour (`IntroCursor.tsx`, the `jo:react` event). The pill must not fight them.

## 3. The bubble

- Build it in code (SVG plus HTML text), not as an animation. Match the illustration's style:
  - the same outline colour and stroke weight as the sprite
  - a warm off-white fill
  - a slightly hand-drawn edge (a gently wobbly SVG path)
  - a tail pointing at Jo's head
- States: **thinking** (a small "…" between Enter and the first token), **streaming**, and **done**.
- After streaming finishes, keep it on screen for about 3 s plus 1 s per line, or until the next `/`. It may overlap page content.
- **When the answer has buttons, don't auto-hide it.** The visitor needs time to read and click. It stays until the visitor clicks a button, clicks or taps anywhere outside the bubble, presses Escape, or presses `/` for a follow-up.
- **Click outside closes it**, with or without buttons: a pointerdown outside the bubble and its buttons (and outside the pill) dismisses the bubble, and Jo leaves on non-hero pages. Ignore the click that opened it. Don't close while the visitor is selecting text inside the bubble.
- While the pointer is over the bubble, or keyboard focus is inside it, pause any auto-hide timer.
- Clicking an `internal` button closes the bubble and navigates. `external` and `mailto` buttons leave it open, since the visitor comes back to the same page.
- Put `aria-live="polite"` on the answer text.
- Respect `prefers-reduced-motion`: no slide-ins or bounces, and text can appear without per-word animation.
- The mouth animation will be added later as sprite frames. Expose an `isTalking` state from the streaming hook: true while tokens arrive, false on `done` or `error`. That way the character can switch to talking frames later without touching the networking code.

## 4. Architecture in the portfolio

- `components/AskJo/` containing `AskJoProvider`, `CursorChatPill`, `JoBubble`, `StandingJo`, `SelectionAskButton`, and a `useJoHotkey` hook.
- `lib/joLlm.ts`: the SSE client above, the error-code → line map, and the `/status` check.
- **Loading:** load the whole AskJo bundle lazily with `next/dynamic` (`ssr: false`), triggered by the first `/` press, a text selection, or a hover over Jo. Only a tiny listener ships in the initial bundle. The first trigger loads the bundle and calls `checkJoStatus()`. If that returns false, nothing appears, ever, for that page load.
- Add `<link rel="preconnect" href={NEXT_PUBLIC_JO_LLM_URL} crossOrigin="anonymous">` in `app/layout.tsx`, and only when the feature is enabled.
- If the site has a Content-Security-Policy, add the Jo LLM origin to `connect-src`.
- Env vars (add them to `.env.local`, `.env.example`, and the hosting provider):

  ```
  NEXT_PUBLIC_JO_LLM_URL=https://jo-llm.navajyothputalath13.workers.dev
  NEXT_PUBLIC_JO_LLM_ENABLED=true
  ```

  For local development against my local backend, use `NEXT_PUBLIC_JO_LLM_URL=http://localhost:8787`.
- If `NEXT_PUBLIC_JO_LLM_ENABLED` isn't `"true"`, or `/status` says disabled, the shortcut, the hint and the selection button don't render at all.

## 5. How to test

1. With the production URL: Jo is currently switched **off** while I fill in his knowledge file. `/status` returns `false`, so the feature should be completely invisible. That's the first test. Tell me when you're ready and I'll run `npm run jo -- on` in the jo-llm repo.
2. Locally: I run the backend in the jo-llm repo with `npm run dev` (port 8787, Jo is on there). Set `NEXT_PUBLIC_JO_LLM_URL=http://localhost:8787` and run the portfolio on port 3000. The backend terminal prints every step of each request.
3. Quick checks:
   - "How can I contact you?" streams an answer.
   - "What is the capital of France?" shows the `offtopic` line.
   - Asking 16 questions within a few seconds shows the `rate_limited` line, and asking again 6 seconds later works.
   - Selecting a paragraph and clicking "Ask Jo" sends it as `quote`.

## Done when

- The interaction works in the hero, on a case study page and via text selection.
- Lighthouse performance on the home page is unchanged.
- Reduced motion and keyboard-only use both work.
- Turning the kill switch off hides the feature within about 30 seconds of a fresh page load.
