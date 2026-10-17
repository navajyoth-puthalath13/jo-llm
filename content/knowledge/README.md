# Jo's knowledge

Everything Jo knows about you lives in these files. Nothing else reaches the model. If a fact isn't here, Jo says "I haven't shared that here" and gives your email.

## The rules

1. **One fact, one place.** Each fact lives in exactly one file. If you're about to write something that's already somewhere else, edit it there instead. Duplicates drift apart and contradict each other, and contradictions are the main cause of made-up answers.
2. **Short bullet lines, not scripts.** Write facts (`- Status: proposed, not shipped.`), not pre-written answers to questions. Jo writes the answer in your voice from the facts.
3. **`TODO:` lines are never facts.** Any line containing `TODO:` is removed before the prompt is built, along with `<!-- comments -->` and `# headings`. Use `TODO:` for anything you still need to check.
4. **Only public information.** Nothing private. Only links you're happy for anyone to see.

## The template

Every file starts with the same frontmatter:

```md
---
id: care-scribe
title: CARE Scribe
covers: what it is, my role, status, what I explored, what I learned
keywords: [care, scribe, ohc, open healthcare network, healthcare, clinician, hospital]
actions: [care-scribe]        # related button ids from content/actions.ts
---

- What it is: …
- My role: …
- Status: proposed direction, not shipped or adopted.
```

- `id`: lowercase letters, digits and hyphens. Must be unique.
- `title`: the heading the model sees above the facts.
- `covers`: one line saying what the file answers. The router reads this to pick files, so make it specific.
- `keywords`: words a visitor might use. These are the fallback when the router is unavailable.
- `actions`: buttons related to this file, from `content/actions.ts`. These are the fallback when the button picker is unavailable.
- `always: true` (optional): include the file in every prompt. Only `voice`, `boundaries`, `about` and `contact` use it. Keep this set small, because every always-file costs tokens on every question.

## How Jo uses them

1. A small model reads the question and the list of `id` + `covers` lines, and picks up to 3 files.
2. Jo answers from the always-files plus those picked files.
3. Another small call picks buttons, then fixed rules in code tidy them up.

## Adding a new project

1. Create `projects/<name>.md` using the template. Give it a clear `covers` line and good `keywords`.
2. If it has its own page, add a button to `content/actions.ts` (and its URL to `LINK_ALLOWLIST` in `wrangler.toml` if it's external), then list that id under `actions:`.
3. Add the path to `files.ts` **and** an import plus an entry to `index.ts`, in the same position.
4. Mention it in `projects/overview.md` if visitors should know about it.
5. Run `npm test`. It fails if the lists disagree, an id repeats, frontmatter is missing or an action doesn't exist.
6. Deploy (`npm run deploy`). Cached answers are invalidated automatically.
