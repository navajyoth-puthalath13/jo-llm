import { describe, expect, it } from "vitest";
import type { AskInput } from "../src/guard/validate";
import { allReplies, followUpFor } from "../src/followups";
import { WHICH_PROJECT } from "../src/project-context";

const input = (over: Partial<AskInput>): AskInput => ({ question: "Tell me more.", ...over });

const ITERATION_3_ANSWER = "Iteration 3, the chosen direction, offers only slot lengths that divide the session exactly.";
const ITERATION_2_ANSWER = "Iteration 2, the nudged end time, moves the end to the nearest slot.";

describe("follow-up question suggestions", () => {
  it("suggests why iteration 2 wasn't chosen, after hearing about iteration 3", () => {
    const reply = followUpFor(input({}), ITERATION_3_ANSWER);
    expect(reply?.label).toBe("Why not iteration 2?");
    expect(reply?.type).toBe("continue_conversation");
  });

  it("suggests iteration 3 after hearing about iteration 2", () => {
    const reply = followUpFor(input({}), ITERATION_2_ANSWER);
    expect(reply?.label).toBe("What was iteration 3?");
  });

  it("never repeats a topic the conversation already asked about", () => {
    const history = [{ q: "Why wasn't iteration 2 chosen?", a: "It changed a time the person typed." }];
    expect(followUpFor(input({ history }), ITERATION_3_ANSWER)).toBeNull();
  });

  // The whole point of the fix: no page, no history, and a question whose wording ("iteration 3")
  // isn't even one of the file's own keywords — nothing "establishes context" ahead of time, but
  // the answer itself is unambiguous, so the suggestion must still appear.
  it("works for a standalone question with no page or history context", () => {
    const reply = followUpFor(input({ page: undefined }), ITERATION_3_ANSWER);
    expect(reply?.label).toBe("Why not iteration 2?");
  });

  it("says nothing for an answer matching no rule", () => {
    expect(followUpFor(input({}), "I'm based in Kerala.")).toBeNull();
    expect(followUpFor(input({}), "CARE Scribe turns consultations into notes.")).toBeNull();
  });

  it("never invents a topic the answer didn't mention", () => {
    // "Iteration" alone, with no number, matches nothing: the rule only fires on what was said.
    expect(followUpFor(input({}), "There were several iterations before the final design.")).toBeNull();
  });

  it("allReplies: a \"which project\" answer keeps its own replies, not a follow-up too", () => {
    const replies = allReplies(input({}), WHICH_PROJECT);
    expect(replies.map((r) => r.label)).toEqual(["Appointment scheduling", "CARE Scribe", "System", "Guideline Agent"]);
  });

  it("allReplies: falls back to the follow-up when there's no which-project or which-role reply", () => {
    expect(allReplies(input({}), ITERATION_3_ANSWER).map((r) => r.label)).toEqual(["Why not iteration 2?"]);
  });
});
