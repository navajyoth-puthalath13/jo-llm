// Catalog-defined buttons. Models only ever propose ids (see buttons.ts); labels, hrefs and kinds
// come from content/actions.ts.

import { ACTIONS, type ActionKind, type JoAction } from "../content/actions";

// Hard cap on buttons under one answer. Usually one; contact questions can get four (email,
// LinkedIn, X and Substack when the answer mentions it). See buttons.ts for the rules.
export const MAX_ACTIONS = 4;

/** What the browser receives. Never contains `when`. */
export interface ResolvedAction {
  id: string;
  label: string;
  href: string;
  kind: ActionKind;
}

const BY_ID = new Map<string, JoAction>(ACTIONS.map((a) => [a.id, a]));

/** Changes whenever entries are added/removed or their `when` changes. Part of the cache key. */
export function catalogFingerprint(catalog: readonly JoAction[] = ACTIONS): string {
  return catalog.map((a) => `${a.id}:${a.when}`).join("|");
}

export function sanitizeActionIds(ids: unknown[]): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const id = raw.trim().toLowerCase();
    if (BY_ID.has(id) && !out.includes(id)) out.push(id);
    if (out.length === MAX_ACTIONS) break;
  }
  return out;
}

export function resolveActions(ids: string[]): ResolvedAction[] {
  return sanitizeActionIds(ids).map((id) => {
    const a = BY_ID.get(id)!;
    return { id: a.id, label: a.label, href: a.href, kind: a.kind };
  });
}

/**
 * Splits streamed model text into what may be shown and what is held back. Everything from the
 * first `[[` onward is held (a trailing lone `[` is held until the next chunk shows whether it
 * starts one) and never shown.
 */
export function createTagSplitter() {
  let carry = "";
  let held: string | null = null;
  return {
    /** Returns the part of `chunk` that is safe to show. */
    push(chunk: string): string {
      if (held !== null) {
        held += chunk;
        return "";
      }
      const text = carry + chunk;
      carry = "";
      const i = text.indexOf("[[");
      if (i !== -1) {
        held = text.slice(i);
        return text.slice(0, i);
      }
      if (text.endsWith("[")) {
        carry = "[";
        return text.slice(0, -1);
      }
      return text;
    },
    /** Visible text still owed at the end (a lone trailing `[`). */
    flush(): string {
      const rest = carry;
      carry = "";
      return rest;
    },
    get held(): string {
      return held ?? "";
    },
  };
}
