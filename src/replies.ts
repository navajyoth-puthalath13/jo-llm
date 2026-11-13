// Reply buttons: buttons that answer Jo's question for the visitor instead of opening a page.
//
// The idea and the wire shape come from OpenUI's @ToAssistant action (openui.com, MIT): a button
// carries a label to show and a message to send, and the host receives a "continue_conversation"
// event and sends the message as the visitor's next turn. Unlike OpenUI, no model writes these:
// they are derived in code from the answer Jo gave, so a reply can never be invented.

import { endsWithQuestion } from "./buttons";
import { WHICH_PROJECT_START } from "./project-context";
import { ASKED_ROLE } from "./route";

export interface Reply {
  id: string;
  /** Shown on the button. */
  label: string;
  type: "continue_conversation";
  /** Sent as the visitor's next question when the button is tapped. */
  message: string;
}

export const MAX_REPLIES = 4;

const reply = (id: string, label: string, message = label): Reply => ({ id, label, type: "continue_conversation", message });

const PROJECT_REPLIES = [
  reply("appointment-scheduling", "Appointment scheduling"),
  reply("care-scribe", "CARE Scribe"),
  reply("system", "System"),
  reply("guideline-agent", "Guideline Agent"),
];

// The roles I'm looking for (content/knowledge/availability.md).
const ROLE_REPLIES = [reply("role-product", "Junior product designer"), reply("role-ux", "UX designer")];

/** The replies to offer under an answer. Derived from the answer text alone, so cached answers get them too. */
export function repliesFor(answer: string): Reply[] {
  if (answer.startsWith(WHICH_PROJECT_START)) return PROJECT_REPLIES;
  if (endsWithQuestion(answer) && ASKED_ROLE.test(answer)) return ROLE_REPLIES;
  return [];
}
