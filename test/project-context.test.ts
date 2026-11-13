import { describe, expect, it } from "vitest";
import { KNOWLEDGE_SOURCES } from "../content/knowledge/index";
import type { AskInput } from "../src/guard/validate";
import { buildKnowledge } from "../src/knowledge";
import { pageProject, projectInContext, WHICH_PROJECT, whichProject } from "../src/project-context";

const knowledge = buildKnowledge(KNOWLEDGE_SOURCES);
const input = (over: Partial<AskInput>): AskInput => ({ question: "What problem were you solving?", ...over });

describe("which project a question is about", () => {
  it("asks which project when nothing says", () => {
    for (const question of [
      "What problem were you solving?",
      "what was the problem",
      "Who were the users?",
      "What did you learn?",
      "Did it ship?",
      "What was your role?",
      "Walk me through the process",
    ]) {
      expect(whichProject(knowledge, input({ question })), question).toBe(WHICH_PROJECT);
    }
    expect(WHICH_PROJECT.endsWith("?")).toBe(true);
  });

  it("uses the page the visitor is reading", () => {
    expect(whichProject(knowledge, input({ page: "/work/appointment-scheduling" }))).toBeNull();
    expect(projectInContext(knowledge, input({ page: "/work/appointment-scheduling/" }))).toBe("appointment-scheduling");
    expect(projectInContext(knowledge, input({ page: "/work/care-scribe" }))).toBe("care-scribe");
    expect(pageProject("/")).toBeNull();
    expect(whichProject(knowledge, input({ page: "/" }))).toBe(WHICH_PROJECT);
  });

  it("uses the project just talked about", () => {
    const history = [{ q: "Tell me about CARE Scribe", a: "CARE Scribe turns consultations into notes." }];
    expect(whichProject(knowledge, input({ history }))).toBeNull();
    expect(projectInContext(knowledge, input({ history }))).toBe("care-scribe");
    // The question beats the page.
    expect(projectInContext(knowledge, input({ question: "What problem did Guideline Agent solve?", page: "/work/care-scribe" }))).toBe("guideline-agent");
  });

  it("answers directly when the question names the project, or isn't about a project's details", () => {
    expect(whichProject(knowledge, input({ question: "What problem were you solving in appointment scheduling?" }))).toBeNull();
    expect(whichProject(knowledge, input({ question: "Who were the users of CARE Scribe?" }))).toBeNull();
    for (const question of ["What problems do you like solving?", "How can I contact you?", "What projects have you worked on?", "hi"]) {
      expect(whichProject(knowledge, input({ question })), question).toBeNull();
    }
  });
});
