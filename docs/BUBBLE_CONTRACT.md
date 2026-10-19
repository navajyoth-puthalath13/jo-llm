# Bubble contract: structured bubble text

Shared by jo-llm (this repo) and the portfolio. Both sides must agree on this; don't change it on one side only.

## Request

`POST /ask` accepts one new optional field: `"format": "blocks"`.

- Without it, the backend behaves exactly as today: flat text with newlines collapsed. This keeps any older client working.
- With it, the answer text may contain structure.

## Streaming text grammar when `format` is `"blocks"`

The `token` events carry plain text. The only structural characters allowed are:

- `\n\n` starts a new paragraph.
- `\n- ` starts a bullet item. An item runs until the next `\n`.
- `\n1. `, `\n2. `, `\n3. ` start numbered items, in order. Use these only when order matters.

Nothing else is allowed: no other newlines, no markdown, no HTML, no emoji, no nested lists, no headings. The backend sanitizer enforces this. The client renders it as text nodes only, never as HTML.

## Limits the backend guarantees

- At most 3 paragraphs.
- At most one list per answer, with 2 to 4 items.
- Each item is one line, about 10 words or fewer.
- An optional single intro sentence before the list.

## Unchanged

- The `actions` event, its `{ id, label, href, kind }` shape, and the order (tokens, then actions, then done or error).
- Error codes.
- History: the client sends past answers flattened to a single line (blocks joined with a space). The backend keeps validating history as plain text.

## Cache

The answer cache key includes `format`, so flat and block answers never mix.

## Implementation notes (jo-llm)

These follow from the grammar above; they don't add to it.

- A list with no intro sentence opens the answer with `\n- `.
- A token never ends in a bare `\n` or `\n-`: separators arrive whole, usually together with the word after them. Cached answers are chunked the same way.
- "About 10 words or fewer" per item is asked of the model and checked by `npm run eval`; the sanitizer doesn't cut items short, since that would change their meaning.
