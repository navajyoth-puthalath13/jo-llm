// Output checks. Answers must be plain text with no markdown, no HTML, and only allow-listed links.
// Works incrementally: text is released only up to the last whitespace, so URLs and markup are
// always seen whole before anything reaches the browser.

/** Strings that should never appear in an answer. Seeing one means a leak or a sentinel slip. */
export const LEAK_MARKERS = ["JO-RULES-7Q4K", "OFFTOPIC", "visitor_question", "selected_text", "previous_exchanges"];

export function containsLeak(text: string): boolean {
  const lower = text.toLowerCase();
  return LEAK_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}

const URL_RE = /\b(?:mailto:[^\s<>()]+|https?:\/\/[^\s<>()]+|www\.[^\s<>()]+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|app|ai|co|me|xyz|in|design|so|sh|ly|gg|tv|page|site)\b(?:\/[^\s<>()]*)?)/gi;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

function isAllowedLink(raw: string, allowlist: string[]): boolean {
  const trimmed = raw.replace(/[.,;:!?'"]+$/, "").toLowerCase();
  const target = trimmed.replace(/^https?:\/\//, "");
  return allowlist.some((entry) => {
    const e = entry.replace(/^https?:\/\//, "");
    if (!target.startsWith(e)) return false;
    const next = target.charAt(e.length);
    return next === "" || next === "/" || next === "?" || next === "#";
  });
}

function filterLinks(text: string, allowlist: string[]): string {
  // Emails first: allowed only if listed as mailto:<email> or the bare address.
  let out = text.replace(EMAIL_RE, (email, offset: number, whole: string) => {
    if (whole.slice(Math.max(0, offset - 7), offset).toLowerCase() === "mailto:") return email;
    return isAllowedLink(`mailto:${email}`, allowlist) || isAllowedLink(email, allowlist) ? email : "";
  });
  out = out.replace(URL_RE, (url) => {
    if (url.includes("@") && !url.toLowerCase().startsWith("mailto:")) return url; // handled above
    if (url.toLowerCase().startsWith("mailto:")) {
      return isAllowedLink(url, allowlist) ? url.replace(/^mailto:/i, "") : "";
    }
    const trailing = url.match(/[.,;:!?'"]+$/)?.[0] ?? "";
    return isAllowedLink(url, allowlist) ? url : trailing;
  });
  return out;
}

function stripMarkup(text: string, atLineStart: boolean): string {
  let out = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, "$1 $2") // links → "text url" (url filtered later)
    .replace(/<\/?[a-z!][^>]*>/gi, "") // HTML tags
    .replace(/[<>]/g, "")
    .replace(/(\*\*|__|~~|`+)/g, "")
    .replace(/(^|[\s(])\*(?=\S)|(?<=\S)\*(?=[\s).,!?]|$)/g, "$1");
  // Block markers only count at the start of a line.
  out = out.replace(/(^|\n)[ \t]*(?:#{1,6}|>|[-*+•]|\d+[.)])[ \t]+/g, (m, nl: string, offset: number) =>
    offset === 0 && !atLineStart ? m : nl,
  );
  return out;
}

/** Full, non-streaming sanitize. Used for cached answers and tests. */
export function sanitizeText(text: string, allowlist: string[]): string {
  return tidy(filterLinks(stripMarkup(text, true), allowlist)).trim();
}

function tidy(s: string): string {
  return s
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1");
}

export interface StreamSanitizer {
  /** Feed raw model text; returns sanitized text safe to send now (may be empty). */
  push(chunk: string): string;
  /** Returns whatever is left at the end of the stream. */
  flush(): string;
  /** Everything received so far, unsanitized. For leak checks only. */
  readonly raw: string;
}

const MAX_HOLD = 400;

export function createStreamSanitizer(allowlist: string[]): StreamSanitizer {
  let pending = "";
  let raw = "";
  let atLineStart = true;
  let lastOut = "";

  const release = (segment: string): string => {
    let out = tidy(filterLinks(stripMarkup(segment, atLineStart), allowlist));
    // Nothing leading, and no double spaces where a removed link used to be.
    if (!lastOut || /\s$/.test(lastOut)) out = out.trimStart();
    if (out) lastOut = out;
    atLineStart = /\n\s*$/.test(segment);
    return out;
  };

  // Hold back while a markdown link or HTML tag is still open.
  const unbalanced = (s: string) =>
    (s.lastIndexOf("[") > s.lastIndexOf(")") && s.lastIndexOf("[") !== -1) || s.lastIndexOf("<") > s.lastIndexOf(">");

  return {
    get raw() {
      return raw;
    },
    push(chunk) {
      raw += chunk;
      pending += chunk;
      const cut = Math.max(pending.lastIndexOf(" "), pending.lastIndexOf("\n"), pending.lastIndexOf("\t"));
      if (cut === -1) return pending.length > MAX_HOLD ? this.flush() : "";
      const ready = pending.slice(0, cut + 1);
      if (unbalanced(ready) && pending.length <= MAX_HOLD) return "";
      pending = pending.slice(cut + 1);
      return release(ready);
    },
    flush() {
      const rest = pending;
      pending = "";
      return rest ? release(rest).trimEnd() : "";
    },
  };
}
