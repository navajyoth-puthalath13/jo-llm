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
  it("contact → email, linkedin, x in that order, whatever was proposed", () => {
    expect(rules({ intent: "contact" }, ["github", "resume"])).toEqual(["email", "linkedin", "x"]);
  });

  it("resume → resume first", () => {
    expect(rules({ intent: "resume" }, ["email"])).toEqual(["resume", "email"]);
  });

  it("a named project → that project's button first", () => {
    expect(rules({ intent: "work_overview", question: "Tell me about Guideline Agent" }, ["work"])[0]).toBe("a11y-agent");
    expect(rules({ intent: "project", question: "and System?", answer: "…" }, ["care-scribe"])).toEqual(["system", "care-scribe"]);
    // Named in the answer only: still first, after projects named in the question.
    expect(rules({ intent: "work_overview", question: "best project?", answer: "Start with System." }, ["work"])).toEqual([
      "system",
      "work",
    ]);
  });

  it("work_overview → work", () => {
    expect(rules({ intent: "work_overview", question: "show me your stuff", answer: "Here's my work." })).toEqual(["work"]);
  });

  it("private → email only, and only if the answer points to email", () => {
    expect(rules({ intent: "private", answer: "I'd rather talk about that over email: navajyothputalath13@gmail.com." }, ["resume"])).toEqual([
      "email",
    ]);
    expect(rules({ intent: "private", answer: "I keep that private." }, ["email", "resume"])).toEqual([]);
  });

  it("smalltalk → none", () => {
    expect(rules({ intent: "smalltalk" }, ["system", "email"])).toEqual([]);
  });

  it("never offers the page the visitor is already on", () => {
    expect(rules({ intent: "project", question: "CARE Scribe?", page: "/work/care-scribe" }, ["care-scribe", "work"])).toEqual(["work"]);
    expect(rules({ intent: "project", question: "CARE Scribe?", page: "/work/care-scribe/" }, ["care-scribe"])).toEqual([]);
    // "/#work" is a section of the homepage, not the homepage itself.
    expect(rules({ intent: "work_overview", page: "/" }, ["work"])).toEqual(["work"]);
  });

  it("at most 3, no duplicates, unknown ids dropped", () => {
    expect(rules({ intent: "how_i_work" }, ["github", "GitHub", "nope", "https://evil.example.com", "about", "work", "x"])).toEqual([
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
      ctx: ctx({ intent: "how_i_work", question: "Side projects?", answer: "A few small tools." }),
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
    for (const intent of ["smalltalk", "private", "contact"] as const) {
      await pickButtons({ providers: [p], knowledge, ctx: ctx({ intent }), budgetMs: 1000, signal: signal() });
    }
    expect(p.calls).toHaveLength(0);
  });
});
