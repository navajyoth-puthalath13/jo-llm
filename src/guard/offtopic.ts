// The model is told to answer off-topic questions with exactly this sentinel. We hold back the
// opening tokens until we know whether the answer starts with it, so a decline never streams.

export const SENTINEL = "[[OFFTOPIC]]";

export type SentinelState = "offtopic" | "pending" | "clear";

/** Classifies the text received so far. `pending` means keep buffering. */
export function detectSentinel(received: string): SentinelState {
  const head = received.trimStart();
  if (head.startsWith(SENTINEL) || head.startsWith("OFFTOPIC")) return "offtopic";
  if (head.length === 0) return "pending";
  if (SENTINEL.startsWith(head) || "OFFTOPIC".startsWith(head)) return "pending";
  return "clear";
}
