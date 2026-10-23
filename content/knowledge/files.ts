// The knowledge files, in the order they appear in Jo's prompt. Plain paths only, so Node scripts
// can read the same list from disk. Adding a file: create it, add it here AND in index.ts.
// test/knowledge.test.ts fails if this list, index.ts and the folder disagree.
export const KNOWLEDGE_FILES = [
  "voice.md",
  "boundaries.md",
  "about.md",
  "contact.md",
  "background.md",
  "experience.md",
  "awards.md",
  "availability.md",
  "hire-me.md",
  "how-i-work.md",
  "accessibility.md",
  "tools.md",
  "projects/overview.md",
  "projects/system.md",
  "projects/care-scribe.md",
  "projects/guideline-agent.md",
  "experiments.md",
  "outside-work.md",
  "portfolio.md",
] as const;
