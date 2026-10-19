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
// There's no /work page on the portfolio (only /work/<slug>), so "work" points at the homepage
// section /#work. Change it if a /work page is added.

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
  // How to reach me
  {
    id: "email",
    label: "Email me",
    href: "mailto:navajyothputalath13@gmail.com",
    kind: "mailto",
    when: "visitor wants to contact me, hire me, talk about an opportunity, or my reply points them to email",
  },
  {
    id: "linkedin",
    label: "Connect on LinkedIn",
    href: "https://www.linkedin.com/in/navajyothp/",
    kind: "external",
    when: "visitor asks how to contact or connect with me, or about LinkedIn",
  },
  {
    id: "x",
    label: "Find me on X",
    href: "https://x.com/putalath",
    kind: "external",
    when: "visitor asks how to contact or follow me, or about X or Twitter",
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
    id: "substack",
    label: "Read my Substack",
    href: "https://navajyothputalath13.substack.com/",
    kind: "external",
    when: "visitor asks about my writing, blog, articles or newsletter",
  },
  // Projects
  {
    id: "system",
    label: "Open System registry",
    href: "https://system-three-rouge.vercel.app/",
    kind: "external",
    when: "visitor asks about System, my design system, its components or registry, or what I'm working on right now",
  },
  {
    id: "care-scribe",
    label: "Read CARE Scribe",
    href: "/work/care-scribe",
    kind: "internal",
    when: "visitor asks about CARE Scribe, Open Healthcare Network, my healthcare work, or my best case study",
  },
  {
    id: "a11y-agent",
    label: "See Guideline Agent",
    href: "/work/a11y-agent",
    kind: "internal",
    when: "visitor asks about Guideline Agent, accessibility in pull requests or my accessibility work",
  },
  // Sections of the site
  {
    id: "all-work",
    label: "See my full work",
    href: "/#work",
    kind: "internal",
    when: "secondary button after an answer about one specific project",
  },
  {
    id: "work",
    label: "See my work",
    href: "/#work",
    kind: "internal",
    when: "visitor wants to see my work, projects or case studies in general",
  },
  {
    id: "experiments",
    label: "See my side projects",
    href: "/experiments",
    kind: "internal",
    when: "visitor asks about side projects, experiments or small tools",
  },
  {
    id: "photography",
    label: "See my photos",
    href: "/#photography",
    kind: "internal",
    when: "visitor asks about my photography or photos",
  },
  {
    id: "about",
    label: "More about me",
    href: "/about",
    kind: "internal",
    when: "visitor wants my background or story in more depth",
  },
];

export const ACTIONS: readonly JoAction[] = Object.freeze(entries.map((a) => Object.freeze({ ...a })));
