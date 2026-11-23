import { describe, expect, it } from "vitest";
import { KNOWLEDGE_SOURCES } from "../content/knowledge/index";
import type { AskInput } from "../src/guard/validate";
import { allReplies, followUpFor } from "../src/followups";
import { buildKnowledge } from "../src/knowledge";
import { WHICH_PROJECT } from "../src/project-context";

const knowledge = buildKnowledge(KNOWLEDGE_SOURCES);
const input = (over: Partial<AskInput>): AskInput => ({ question: "Tell me more.", page: "/work/appointment-scheduling", ...over });

const ITERATION_3_ANSWER = "Iteration 3, the chosen direction, offers only slot lengths that divide the session exactly.";
const ITERATION_2_ANSWER = "Iteration 2, the nudged end time, moves the end to the nearest slot.";

describe("follow-up question suggestions", () => {
  it("suggests why iteration 2 wasn't chosen, after hearing about iteration 3", () => {
    const reply = followUpFor(knowledge, input({}), ITERATION_3_ANSWER);
    expect(reply?.label).toBe("Why not iteration 2?");
    expect(reply?.type).toBe("continue_conversation");
  });

  it("suggests iteration 3 after hearing about iteration 2", () => {
    const reply = followUpFor(knowledge, input({}), ITERATION_2_ANSWER);
    expect(reply?.label).toBe("What was iteration 3?");
  });

  it("never repeats a topic the conversation already asked about", () => {
    const history = [{ q: "Why wasn't iteration 2 chosen?", a: "It changed a time the person typed." }];
    expect(followUpFor(knowledge, input({ history }), ITERATION_3_ANSWER)).toBeNull();
  });

  it("says nothing without a project in context", () => {
    expect(followUpFor(knowledge, input({ page: undefined }), ITERATION_3_ANSWER)).toBeNull();
  });

  it("says nothing for a project with no rule set, or an answer matching no rule", () => {
    expect(followUpFor(knowledge, input({ page: "/work/care-scribe" }), ITERATION_3_ANSWER)).toBeNull();
    expect(followUpFor(knowledge, input({}), "I'm based in Kerala.")).toBeNull();
  });

  it("never invents a topic the answer didn't mention", () => {
    // "Iteration" alone, with no number, matches nothing: the rule only fires on what was said.
    expect(followUpFor(knowledge, input({}), "There were several iterations before the final design.")).toBeNull();
  });

  it("allReplies: a \"which project\" answer keeps its own replies, not a follow-up too", () => {
    const replies = allReplies(knowledge, input({}), WHICH_PROJECT);
    expect(replies.map((r) => r.label)).toEqual(["Appointment scheduling", "CARE Scribe", "System", "Guideline Agent"]);
  });

  it("allReplies: falls back to the follow-up when there's no which-project or which-role reply", () => {
    expect(allReplies(knowledge, input({}), ITERATION_3_ANSWER).map((r) => r.label)).toEqual(["Why not iteration 2?"]);
  });
});
