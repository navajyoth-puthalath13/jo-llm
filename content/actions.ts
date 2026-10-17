// Jo's action catalog: the only buttons Jo can ever offer.
//
// The model only sees `id` and `when` (rendered into the rules in src/prompt.ts). It picks ids;
// the server looks up label, href and kind here, so the model can never invent a destination.
//
// Rules for entries:
// - `internal` hrefs are paths on navajyoth.com; `external` are full https URLs; `mailto` is mailto:.
// - Every external and mailto href must pass the link allowlist (test/actions.test.ts checks).
// - Labels are first person, verb-first, at most 24 characters.
// - Editing a label or href takes effect immediately, cached answers included. Adding or removing
//   an entry, or changing `when`, invalidates cached answers.
//
// LinkedIn is left out on purpose: the portfolio still has a placeholder URL. Add it once it's real.

export type ActionKind = "internal" | "external" | "mailto";

export interface JoAction {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly kind: ActionKind;
  /** When the action fits. Used only inside the system prompt. */
  readonly when: string;
}

const entries: JoAction[] = [
  {
    id: "email",
    label: "Email me",
    href: "mailto:navajyothputalath13@gmail.com",
    kind: "mailto",
    when: "visitor wants to contact me, talk about an opportunity, or my reply points them to email",
  },
  {
    id: "resume",
    label: "Open my resume",
    href: "https://drive.google.com/file/d/19pVWr0N1-GL_lnKO11iLGKijxkJuT8qR/view?usp=drive_link",
    kind: "external",
    when: "visitor asks for my resume or CV",
  },
  {
    id: "github",
    label: "See my GitHub",
    href: "https://github.com/navajyoth-puthalath13",
    kind: "external",
    when: "visitor asks about my code, GitHub or open-source work",
  },
  {
    id: "x",
    label: "Find me on X",
    href: "https://x.com/putalath",
    kind: "external",
    when: "visitor asks about my X or Twitter, or where to follow me",
  },
  {
    id: "work",
    label: "See my work",
    href: "/#work",
    kind: "internal",
    when: "visitor wants to see my work or projects in general",
  },
  {
    id: "photography",
    label: "See my photos",
    href: "/#photography",
    kind: "internal",
    when: "visitor asks about my photography",
  },
  {
    id: "experiments",
    label: "See my experiments",
    href: "/experiments",
    kind: "internal",
    when: "visitor asks about my experiments, side projects or small tools",
  },
  {
    id: "about",
    label: "More about me",
    href: "/about",
    kind: "internal",
    when: "visitor wants my background or story in more depth",
  },
  {
    id: "care-scribe",
    label: "Read CARE Scribe",
    href: "/work/care-scribe",
    kind: "internal",
    when: "visitor asks about CARE Scribe, Open Healthcare Network or my healthcare work, or my best project",
  },
  {
    id: "a11y-agent",
    label: "See Guideline Agent",
    href: "/work/a11y-agent",
    kind: "internal",
    when: "visitor asks about Guideline Agent, accessibility in pull requests or my accessibility work",
  },
];

export const ACTIONS: readonly JoAction[] = Object.freeze(entries.map((a) => Object.freeze({ ...a })));
