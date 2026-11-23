// A follow-up question suggestion: a tap-to-send button that continues the conversation with one
// specific next question, grounded in what Jo's answer actually said about the project in
// context. Never invents a topic the answer didn't mention, and never repeats one the
// conversation already asked about.
//
// Deterministic, like the rest of Jo's buttons: the model never writes the label or the message.

import type { AskInput } from "./guard/validate";
import type { Knowledge } from "./knowledge";
import { projectInContext } from "./project-context";
import { repliesFor, type Reply } from "./replies";

interface FollowUpRule {
  /** Jo's answer just covered this. */
  topic: RegExp;
  /** Skip if the question or an earlier exchange already asked about this. */
  asked: RegExp;
  label: string;
  message: string;
}

// Appointment scheduling's own structure (content/knowledge/projects/appointment-scheduling.md):
// three iterations, then the chosen direction, then the current status. Each rule only fires on
// what the answer actually named, in the order the case study tells it.
const APPOINTMENT_SCHEDULING: FollowUpRule[] = [
  {
    topic: /\b(?:iteration 3|chosen direction|factor-based)\b/i,
    asked: /\biteration 2\b|nudged end time/i,
    label: "Why not iteration 2?",
    message: "Why wasn't iteration 2, the nudged end time, chosen?",
  },
  {
    topic: /\b(?:iteration 2|nudged end time)\b/i,
    asked: /\biteration 3\b|chosen direction|factor-based/i,
    label: "What was iteration 3?",
    message: "What was iteration 3, the chosen direction?",
  },
  {
    topic: /\b(?:iteration 1|shift hours)\b/i,
    asked: /\biteration 2\b|nudged end time/i,
    label: "What came after that?",
    message: "What was tried after shift hours, iteration 1?",
  },
  {
    topic: /\bunder discussion|inline error|date picker|current status\b/i,
    asked: /what did you learn/i,
    label: "What did you learn?",
    message: "What did you learn from this project?",
  },
];

const RULES: Partial<Record<string, FollowUpRule[]>> = {
  "appointment-scheduling": APPOINTMENT_SCHEDULING,
};

/**
 * One grounded follow-up suggestion for the project the answer was about, or null: no project in
 * context, no rule set for that project, nothing in the answer matches, or the conversation
 * already covered it.
 */
export function followUpFor(knowledge: Knowledge, input: AskInput, answer: string): Reply | null {
  const project = projectInContext(knowledge, input);
  if (!project) return null;
  const rules = RULES[project];
  if (!rules) return null;
  const asked = [input.question, ...(input.history ?? []).flatMap((h) => [h.q, h.a])].join("\n");
  for (const rule of rules) {
    if (!rule.topic.test(answer)) continue;
    if (rule.asked.test(asked)) continue;
    return { id: `followup-${project}`, label: rule.label, type: "continue_conversation", message: rule.message };
  }
  return null;
}

/**
 * The replies to offer under an answer: "which project?" or "which role?" replies when Jo just
 * asked one of those, otherwise a single grounded follow-up question if there's one to offer.
 */
export function allReplies(knowledge: Knowledge, input: AskInput, answer: string): Reply[] {
  const base = repliesFor(answer);
  if (base.length) return base;
  const followUp = followUpFor(knowledge, input, answer);
  return followUp ? [followUp] : [];
}
