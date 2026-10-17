// Bundles the knowledge files into the Worker at build time (wrangler.toml Text rule for *.md).
// Same order as files.ts.
import voice from "./voice.md";
import boundaries from "./boundaries.md";
import about from "./about.md";
import contact from "./contact.md";
import background from "./background.md";
import experience from "./experience.md";
import availability from "./availability.md";
import howIWork from "./how-i-work.md";
import accessibility from "./accessibility.md";
import tools from "./tools.md";
import overview from "./projects/overview.md";
import system from "./projects/system.md";
import careScribe from "./projects/care-scribe.md";
import guidelineAgent from "./projects/guideline-agent.md";
import experiments from "./experiments.md";
import outsideWork from "./outside-work.md";
import portfolio from "./portfolio.md";

export interface KnowledgeSource {
  path: string;
  text: string;
}

export const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  { path: "voice.md", text: voice },
  { path: "boundaries.md", text: boundaries },
  { path: "about.md", text: about },
  { path: "contact.md", text: contact },
  { path: "background.md", text: background },
  { path: "experience.md", text: experience },
  { path: "availability.md", text: availability },
  { path: "how-i-work.md", text: howIWork },
  { path: "accessibility.md", text: accessibility },
  { path: "tools.md", text: tools },
  { path: "projects/overview.md", text: overview },
  { path: "projects/system.md", text: system },
  { path: "projects/care-scribe.md", text: careScribe },
  { path: "projects/guideline-agent.md", text: guidelineAgent },
  { path: "experiments.md", text: experiments },
  { path: "outside-work.md", text: outsideWork },
  { path: "portfolio.md", text: portfolio },
];
