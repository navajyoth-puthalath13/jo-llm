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

describe("button rules (first = primary, second = secondary)", () => {
  // Every row of the intent table.
  it("one specific project → that project, then See my full work", () => {
    expect(rules({ intent: "project", question: "Tell me about CARE Scribe", answer: "A direction I proposed." }, ["system"])).toEqual([
      "care-scribe",
      "all-work",
    ]);
    expect(rules({ intent: "project", question: "What is Guideline Agent?" }, ["work"])).toEqual(["a11y-agent", "all-work"]);
    // Not named, but routed to a project file.
    expect(rules({ intent: "project", files: ["system"], question: "what's the registry?" })).toEqual(["system", "all-work"]);
  });

  it("work overview → See my work, then System", () => {
    const answer = "My main projects are System, CARE Scribe and Guideline Agent.";
    expect(rules({ intent: "work_overview", question: "What have you worked on?", answer }, ["care-scribe", "a11y-agent"])).toEqual([
      "work",
      "system",
    ]);
  });

  it("who are you / are you an AI → Email me, then More about me", () => {
    expect(rules({ intent: "about", question: "Are you an AI?", answer: "I'm an AI version of him." }, ["github"])).toEqual(["email", "about"]);
  });

  it("contact → email, LinkedIn, X (the only case with 3)", () => {
    expect(rules({ intent: "contact", answer: "Email me, or find me on LinkedIn, X or Substack." }, ["github", "substack"])).toEqual([
      "email",
      "linkedin",
      "x",
    ]);
  });

  it("resume → resume, then email", () => {
    expect(rules({ intent: "resume" }, ["linkedin"])).toEqual(["resume", "email"]);
  });

  it("private → email only", () => {
    expect(rules({ intent: "private", answer: "I keep that private." }, ["resume"])).toEqual(["email"]);
  });

  it("how I work → See my work, then More about me", () => {
    const answer = "I bring engineers in early and review pull requests while keeping the workflow central.";
    expect(rules({ intent: "how_i_work", question: "Walk me through your process", answer }, ["a11y-agent"])).toEqual(["work", "about"]);
    // "pull requests" in an answer doesn't name Guideline Agent; asking about pull requests does.
    expect(namedProjects(knowledge, "Why should we hire a senior designer?", answer)).toEqual([]);
    expect(namedProjects(knowledge, "Do you have anything for pull request reviews?", "")).toEqual(["guideline-agent"]);
  });

  it("availability → email, then resume", () => {
    expect(rules({ intent: "availability", answer: "Yes, I'm open to work." }, ["system", "work"])).toEqual(["email", "resume"]);
  });

  it("why hire me → no buttons while asking the role, then Email me, See my work", () => {
    expect(rules({ intent: "hire_me", answer: "Happy to tell you! What kind of role are you hiring for?" })).toEqual([]);
    expect(rules({ intent: "hire_me", answer: "For a junior UX role: I've designed hospital workflows at OHC. Let's talk over coffee." })).toEqual([
      "email",
      "work",
    ]);
  });

  it("greeting → no buttons", () => {
    expect(rules({ intent: "smalltalk", answer: "Hey! How can I help you today?" }, ["system", "email"])).toEqual([]);
  });

  it("identity questions → Email me, then More about me, even when routed as small talk", () => {
    for (const question of ["Are you an AI?", "are you real", "Who are you?", "Who am I talking to?"]) {
      expect(rules({ intent: "smalltalk", question, answer: "I'm an AI version of Navajyoth." }), question).toEqual(["email", "about"]);
    }
    expect(rules({ intent: "smalltalk", question: "hi", answer: "Hey! How can I help you today?" })).toEqual([]);
  });

  it("small talk that invites email (are you an AI?) → Email me, then More about me", () => {
    expect(rules({ intent: "smalltalk", answer: "You're talking to an AI version of me; the real me is reachable over email." })).toEqual([
      "email",
      "about",
    ]);
  });

  it("an answer naming two or more projects is an overview → See my work, then System", () => {
    const answer = "I've worked on:\n- System: my design system\n- CARE Scribe: healthcare work\n- Guideline Agent: PR reviewer";
    for (const intent of ["project", "experience"] as const) {
      expect(rules({ intent, question: "what projects have you worked on?", answer }, ["system", "care-scribe"])).toEqual(["work", "system"]);
    }
    // Named in the question: still that project.
    expect(rules({ intent: "project", question: "Tell me about CARE Scribe", answer: "Unlike System, CARE Scribe…" })).toEqual([
      "care-scribe",
      "all-work",
    ]);
  });

  it("writing → Substack first, photography → photos first (then the model's pick)", () => {
    expect(rules({ intent: "writing" })).toEqual(["substack"]);
    expect(rules({ intent: "photography" }, ["experiments"])).toEqual(["photography", "experiments"]);
  });

  // The email rule.
  it("an answer that mentions emailing always gets Email me, first", () => {
    expect(rules({ intent: "experience", answer: "I'd love to talk about that, you can email me." }, ["care-scribe"])).toEqual([
      "email",
      "care-scribe",
    ]);
    // Nothing else fits: More about me follows it.
    expect(rules({ intent: "experience", answer: "Let's talk over coffee, just email me." })).toEqual(["email", "about"]);
    // how I work answers that invite email: email leads.
    expect(rules({ intent: "how_i_work", answer: "Email me and we'll talk it through." })).toEqual(["email", "work"]);
  });

  it("…but a specific project or the resume keeps first place, with email second", () => {
    expect(rules({ intent: "project", question: "Tell me about CARE Scribe", answer: "Email me for more." })).toEqual([
      "care-scribe",
      "email",
    ]);
    expect(rules({ intent: "resume", answer: "You can see it, or email me." })).toEqual(["resume", "email"]);
  });

  // The current-page rule.
  it("never offers the page the visitor is on; the secondary moves up", () => {
    expect(rules({ intent: "about", page: "/about" })).toEqual(["email"]);
    expect(rules({ intent: "how_i_work", page: "/about/" })).toEqual(["work"]);
    // "/#work" is a section of the homepage, not the homepage itself.
    expect(rules({ intent: "work_overview", page: "/" })).toEqual(["work", "system"]);
  });

  it("a project button removed on its own page isn't replaced: all-work never leads", () => {
    expect(rules({ intent: "project", question: "Tell me about CARE Scribe", page: "/work/care-scribe" })).toEqual([]);
  });

  // Exclusivity and caps.
  it("never See my work and See my full work together; all-work only after a project", () => {
    expect(rules({ intent: "experience" }, ["work", "all-work"])).toEqual(["work"]);
    expect(rules({ intent: "experience" }, ["all-work", "about"])).toEqual(["about"]);
    expect(rules({ intent: "experience" }, ["care-scribe", "all-work"])).toEqual(["care-scribe", "all-work"]);
  });

  it("at most 2 (contact 3), no duplicates, unknown ids dropped", () => {
    expect(rules({ intent: "experience" }, ["github", "GitHub", "nope", "https://evil.example.com", "about", "work", "x"])).toEqual([
      "github",
      "about",
    ]);
    expect(rules({ intent: "contact" })).toHaveLength(3);
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
      ctx: ctx({ intent: "experience", question: "Side projects?", answer: "A few small tools." }),
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
        ctx: ctx({ intent: "experience", files: ["care-scribe"], question: "What did you do at OHC?", answer: "…" }),
        budgetMs: 100,
        signal: signal(),
      });
      expect(r).toEqual({ ids: ["care-scribe"], source: "fallback" });
    }
  });

  it("doesn't spend a call when the rules decide on their own", async () => {
    const p = mockJsonProvider(JSON.stringify({ actions: ["system"] }));
    for (const intent of ["smalltalk", "private", "contact", "resume", "work_overview", "about", "how_i_work", "availability"] as const) {
      await pickButtons({ providers: [p], knowledge, ctx: ctx({ intent }), budgetMs: 1000, signal: signal() });
    }
    await pickButtons({ providers: [p], knowledge, ctx: ctx({ intent: "project", question: "What is System?" }), budgetMs: 1000, signal: signal() });
    expect(p.calls).toHaveLength(0);
  });
});
