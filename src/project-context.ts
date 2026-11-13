// Which project a question is about, when the question itself doesn't say.
// "What problem were you solving?" means the project the visitor is reading, or the one the
// conversation was just about. With neither, Jo asks which project instead of guessing.

import { namedProjects } from "./buttons";
import type { AskInput } from "./guard/validate";
import type { Knowledge } from "./knowledge";

/** Case study pages and the knowledge file for each. */
const PAGE_PROJECT: Record<string, string> = {
  "/work/appointment-scheduling": "appointment-scheduling",
  "/work/care-scribe": "care-scribe",
  "/work/a11y-agent": "guideline-agent",
};

/** A question about "the" project that only makes sense once you know which project. */
const PROJECT_DETAIL =
  /\b(?:(?:what|which) (?:was|were|is|are) the (?:problems?|challenges?|pain points?)|(?:what|which) (?:problems?|challenges?) (?:were|was|did) you|what(?:'s| is| was) the problem you|(?:(?:who|what) (?:were|are|was|is) the (?:users?|outcomes?|results?|solution|impact|constraints?)|who (?:used|uses|is it for|was it for)|what did you (?:learn|propose|design|build|change|find)|what (?:was|is) your role|did it ship|was it shipped|what would you do differently|walk me through (?:the|your) (?:process|iterations?|project|case study)|how many iterations|what was wrong with|what were the iterations))\b/i;

/** The project file for the page the visitor is on, if it's a case study page. */
export function pageProject(page: string | undefined): string | null {
  const path = (page ?? "").replace(/\/+$/, "");
  return PAGE_PROJECT[path] ?? null;
}

/**
 * The project the conversation is about: named in the question, then the selected text, then the
 * last exchange, then the page. Null when nothing points at one project.
 */
export function projectInContext(knowledge: Knowledge, input: AskInput): string | null {
  const one = (text: string) => {
    const found = [...new Set(namedProjects(knowledge, text, "").map((id) => (id === "appointment-scheduling-page" ? "appointment-scheduling" : id)))];
    return found.length === 1 ? found[0]! : null;
  };
  const last = input.history?.at(-1);
  return (
    one(input.question) ??
    (input.quote ? one(input.quote) : null) ??
    (last ? one(last.q) ?? one(last.a) : null) ??
    pageProject(input.page)
  );
}

export const isProjectDetailQuestion = (question: string) => PROJECT_DETAIL.test(question);

/** Jo's question back when a project-detail question doesn't say which project. */
export const WHICH_PROJECT = "Which project do you mean: Appointment scheduling, CARE Scribe, System or Guideline Agent?";

/** WHICH_PROJECT when the question needs a project and nothing says which one; otherwise null. */
export function whichProject(knowledge: Knowledge, input: AskInput): string | null {
  if (!isProjectDetailQuestion(input.question)) return null;
  // Two projects named ("compare System and CARE Scribe") is not ambiguous either.
  if (namedProjects(knowledge, input.question, "").length > 1) return null;
  return projectInContext(knowledge, input) ? null : WHICH_PROJECT;
}
