import { describe, expect, it } from "vitest";
import { KNOWLEDGE_SOURCES } from "../content/knowledge/index";
import { applyButtonRules, fallbackCandidates, namedProjects, pickButtons, type ButtonContext } from "../src/buttons";
import { buildKnowledge } from "../src/knowledge";
import { ProviderHttpError } from "../src/providers/types";
import { resetCooldowns } from "../src/providers/router";
import { mockJsonProvider } from "./helpers";

const knowledge = buildKnowledge(KNOWLEDGE_SOURCES);
const ctx = (over: Partial<ButtonContext>): ButtonContext => ({
  intent: "about",
  files: [],
  question: "q",
  answer: "a",
  ...over,
});
const rules = (over: Partial<ButtonContext>, candidates: string[] = []) => applyButtonRules(knowledge, ctx(over), candidates);

describe("button rules", () => {
  it("contact → email, linkedin, x in that order, never GitHub", () => {
    expect(rules({ intent: "contact" }, ["github", "resume"])).toEqual(["email", "linkedin", "x"]);
  });

  it("contact → plus Substack when the answer mentions it", () => {
    const answer = "Find me on LinkedIn and X, or read my writing on Substack.";
    expect(rules({ intent: "contact", answer }, ["github"])).toEqual(["email", "linkedin", "x", "substack"]);
  });

  it("availability → email first, then resume; never a project", () => {
    expect(rules({ intent: "availability", answer: "Yes, I'm open to work." }, ["system", "work"])).toEqual(["email", "resume"]);
  });

  it("resume → only Open my resume, never an email button", () => {
    expect(rules({ intent: "resume", answer: "Email me if you have questions." }, ["email", "linkedin"])).toEqual(["resume"]);
  });

  it("a named project → that project's button first", () => {
    expect(rules({ intent: "project", question: "Tell me about Guideline Agent" }, ["work"])[0]).toBe("a11y-agent");
    expect(rules({ intent: "project", question: "and System?", answer: "…" }, ["care-scribe"])).toEqual(["system", "care-scribe"]);
    // Named in the answer only: still before the model's other picks.
    expect(rules({ intent: "project", question: "best project?", answer: "Start with System." }, ["work"])).toEqual(["system", "work"]);
  });

  it("how I work / why hire → See my work first; 'pull requests' in the answer isn't Guideline Agent", () => {
    const answer = "I bring engineers in early and review pull requests while keeping the workflow central.";
    expect(rules({ intent: "how_i_work", question: "How do you work with engineers?", answer }, ["a11y-agent", "email"])[0]).toBe("work");
    expect(rules({ intent: "how_i_work", question: "How do you work with engineers?", answer }, [])).toEqual(["work"]);
    expect(namedProjects(knowledge, "Why should we hire a senior designer?", answer)).toEqual([]);
    // Asking about pull requests still points at it.
    expect(namedProjects(knowledge, "Do you have anything for pull request reviews?", "")).toEqual(["guideline-agent"]);
  });

  it("work_overview → work first, even when the answer names every project", () => {
    expect(rules({ intent: "work_overview", question: "show me your stuff", answer: "Here's my work." })).toEqual(["work"]);
    const answer = "My main projects are System, CARE Scribe and Guideline Agent.";
    expect(rules({ intent: "work_overview", question: "Show me all your work", answer }, [])).toEqual(["work", "system", "care-scribe"]);
  });

  it("private → email only, and only if the answer points to email", () => {
    expect(rules({ intent: "private", answer: "I'd rather talk about that over email: navajyothputalath13@gmail.com." }, ["resume"])).toEqual([
      "email",
    ]);
    expect(rules({ intent: "private", answer: "I keep that private." }, ["email", "resume"])).toEqual([]);
  });

  it("smalltalk → just More about me", () => {
    expect(rules({ intent: "smalltalk" }, ["system", "email"])).toEqual(["about"]);
  });

  it("never offers the page the visitor is already on", () => {
    expect(rules({ intent: "project", question: "CARE Scribe?", page: "/work/care-scribe" }, ["care-scribe", "work"])).toEqual(["work"]);
    expect(rules({ intent: "project", question: "CARE Scribe?", page: "/work/care-scribe/" }, ["care-scribe"])).toEqual([]);
    // "/#work" is a section of the homepage, not the homepage itself.
    expect(rules({ intent: "work_overview", page: "/" }, ["work"])).toEqual(["work"]);
  });

  it("at most 3, no duplicates, unknown ids dropped", () => {
    expect(rules({ intent: "about" }, ["github", "GitHub", "nope", "https://evil.example.com", "about", "work", "x"])).toEqual([
      "github",
      "about",
      "work",
    ]);
  });

  it("writing → substack, photography → photography", () => {
    expect(rules({ intent: "writing" })).toEqual(["substack"]);
    expect(rules({ intent: "photography" }, ["experiments"])).toEqual(["photography", "experiments"]);
  });

  it("finds projects by name, not by generic words", () => {
    expect(namedProjects(knowledge, "Tell me about the care scribe project", "")).toEqual(["care-scribe"]);
    expect(namedProjects(knowledge, "how do you work on a system?", "")).toEqual(["system"]);
    expect(namedProjects(knowledge, "what do you care about?", "I care about people.")).toEqual([]);
  });

  it("fallback candidates come from the routed files' frontmatter", () => {
    expect(fallbackCandidates(knowledge, ["care-scribe", "outside-work"])).toEqual(["care-scribe", "photography"]);
  });
});

describe("button picker", () => {
  const signal = () => new AbortController().signal;

  it("uses the model's picks, then the rules", async () => {
    const p = mockJsonProvider(JSON.stringify({ actions: ["experiments", "github"] }));
    const r = await pickButtons({
      providers: [p],
      knowledge,
      ctx: ctx({ intent: "about", question: "Side projects?", answer: "A few small tools." }),
      budgetMs: 1000,
      signal: signal(),
    });
    expect(r).toEqual({ ids: ["experiments", "github"], source: "model" });
    expect(p.calls[0]!.user).toContain("<jo_answer>A few small tools.</jo_answer>");
  });

  it("falls back to the routed files' actions when the call fails or times out", async () => {
    resetCooldowns();
    for (const p of [
      mockJsonProvider("{}", { fail: new ProviderHttpError(500) }),
      mockJsonProvider(JSON.stringify({ actions: ["system"] }), { delayMs: 300 }),
      mockJsonProvider("nonsense"),
    ]) {
      const r = await pickButtons({
        providers: [p],
        knowledge,
        ctx: ctx({ intent: "project", files: ["care-scribe"], question: "Tell me about CARE Scribe", answer: "…" }),
        budgetMs: 100,
        signal: signal(),
      });
      expect(r).toEqual({ ids: ["care-scribe"], source: "fallback" });
    }
  });

  it("doesn't spend a call when the rules decide on their own", async () => {
    const p = mockJsonProvider(JSON.stringify({ actions: ["system"] }));
    for (const intent of ["smalltalk", "private", "contact", "resume"] as const) {
      await pickButtons({ providers: [p], knowledge, ctx: ctx({ intent }), budgetMs: 1000, signal: signal() });
    }
    expect(p.calls).toHaveLength(0);
  });
});
