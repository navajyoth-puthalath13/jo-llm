// Output checks. Answers must be plain text with no markdown, no HTML, and only allow-listed links.
// Works incrementally: text is released only up to the last whitespace, so URLs and markup are
// always seen whole before anything reaches the browser.
//
// Two formats (docs/BUBBLE_CONTRACT.md):
// - "flat" (default): one line of text, every newline collapsed. Unchanged for older clients.
// - "blocks": the same text, plus exactly three kinds of structure: "\n\n" (new paragraph),
//   "\n- " (bullet item) and "\n1. " (numbered item). A structure step runs first and turns every
//   other newline into a space, normalizes markers and enforces the limits; the inline cleaning
//   below then runs as before, keeping those separators intact.

export type AnswerFormat = "flat" | "blocks";

export const MAX_PARAGRAPHS = 3;
export const MAX_ITEMS = 4;

/** Strings that should never appear in an answer. Seeing one means a leak or a sentinel slip. */
export const LEAK_MARKERS = ["JO-RULES-7Q4K", "OFFTOPIC", "visitor_question", "selected_text", "previous_exchanges"];

export function containsLeak(text: string): boolean {
  const lower = text.toLowerCase();
  return LEAK_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}

const URL_RE = /\b(?:mailto:[^\s<>()]+|https?:\/\/[^\s<>()]+|www\.[^\s<>()]+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|app|ai|co|me|xyz|in|design|so|sh|ly|gg|tv|page|site)\b(?:\/[^\s<>()]*)?)/gi;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

/**
 * Every link and email written in the knowledge files is allowed automatically: they are the trusted source,
 * so Jo can always share what it says, without keeping LINK_ALLOWLIST in sync by hand.
 */
export function linksFromKnowledge(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/https?:\/\/[^\s<>()"'`]+/gi)) {
    const link = m[0].replace(/[.,;:!?'"\]]+$/, "").replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
    if (link) out.add(link);
  }
  for (const m of md.matchAll(EMAIL_RE)) out.add(`mailto:${m[0].toLowerCase()}`);
  return [...out];
}

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
  out = out.replace(URL_RE, (url, offset: number, whole: string) => {
    // The domain half of an email that survived the email pass is not a separate link.
    if (whole.charAt(offset - 1) === "@") return url;
    if (url.includes("@") && !url.toLowerCase().startsWith("mailto:")) return url; // handled above
    if (url.toLowerCase().startsWith("mailto:")) {
      return isAllowedLink(url, allowlist) ? url.replace(/^mailto:/i, "") : "";
    }
    const trailing = url.match(/[.,;:!?'"]+$/)?.[0] ?? "";
    return isAllowedLink(url, allowlist) ? url : trailing;
  });
  return out;
}

// Blocks mode never shows a link or an email address, even an allowed one: the buttons carry them
// (docs/BUBBLE_CONTRACT.md). Each one is cut out, then the words that only pointed at it go too:
// "Read more: <url>" disappears, "email me at <email>." becomes "email me.", "portfolio: <url>"
// becomes "portfolio.". Leak and allowlist checks still run on the raw text.
const GONE = "\u0000";
const LEAD_IN_WORDS = String.raw`read more|more here|here(?:'|’)s the link|the link|link|here|see|at|via`;
const LEAD_IN_BEFORE_GONE = new RegExp(String.raw`[ \t]*\b(?:${LEAD_IN_WORDS})\b[ \t]*:?[ \t]*\u0000`, "gi");
/** A segment ending in words that may lead into a link (or the start of such a phrase): held until the next word shows. */
export const LEAD_IN_TAIL = new RegExp(
  String.raw`(?:\b(?:read(?: more)?|more(?: here)?|here(?:'|’)s(?: the(?: link)?)?|the(?: link)?|link|here|see|at|via)\b[ \t]*:?|\S*:)[ \t]*$`,
  "i",
);
// Stands in for the text already sent, so a segment's first words are judged in context.
const PREV = "\u0001";

/** `prev` is the last character already shown (segments always meet at whitespace). */
function dropLinks(text: string, prev = ""): string {
  const prefix = prev ? prev + PREV : "";
  let out = (prefix + text).replace(EMAIL_RE, GONE);
  out = out.replace(URL_RE, (url, offset: number, whole: string) => {
    if (whole.charAt(offset - 1) === GONE) return GONE; // rest of an email
    return GONE + (url.match(/[.,;:!?'"]+$/)?.[0] ?? "");
  });
  return out
    .replace(/[ \t]*\([ \t]*\u0000+[ \t]*\)/g, GONE)
    .replace(LEAD_IN_BEFORE_GONE, GONE)
    .replace(/[ \t]*:?[ \t]*\u0000+([.!?,;:]?)/g, (m, punct: string, offset: number, whole: string) => {
      const head = whole.slice(0, offset).replace(/\u0001/g, "");
      // Right after a list marker ("- ", "1. ") the link was the whole item: leave nothing.
      const before = /(?:^|\n)(?:-|\d{1,2}\.)$/.test(head) ? "" : head.slice(-1);
      const endsHere = /^[ \t]*(?:\n|$)/.test(whole.slice(offset + m.length));
      if (punct && punct !== ":" && !(punct === "," && endsHere)) return !before || /[.!?\n]/.test(before) ? "" : punct;
      // The link ended the sentence: close it, unless it already ends with punctuation.
      return endsHere && before && !/[.!?:\n]/.test(before) ? "." : "";
    })
    .slice(prefix.length);
}

function stripMarkup(text: string, atLineStart: boolean, blocks = false): string {
  let out = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, "$1 $2") // links → "text url" (url filtered later)
    .replace(/<\/?[a-z!][^>]*>/gi, "") // HTML tags
    .replace(/[<>]/g, "")
    .replace(/(\*\*|__|~~|`+)/g, "")
    .replace(/(^|[\s(])\*(?=\S)|(?<=\S)\*(?=[\s).,!?]|$)/g, "$1");
  // Block markers only count at the start of a line. In blocks mode list markers are already
  // canonical ("\n- ", "\n1. ") and are kept; headings and quotes still go.
  const markers = blocks ? /(^|\n)[ \t]*(?:#{1,6}|>)[ \t]+/g : /(^|\n)[ \t]*(?:#{1,6}|>|[-*+•]|\d+[.)])[ \t]+/g;
  out = out.replace(markers, (m, nl: string, offset: number) =>
    offset === 0 && !atLineStart ? m : nl,
  );
  return out;
}

/** Full, non-streaming sanitize. Used for cached answers and tests. */
export function sanitizeText(text: string, allowlist: string[], format: AnswerFormat = "flat"): string {
  if (format === "flat") return tidy(filterLinks(stripMarkup(text, true), allowlist)).trim();
  const s = createStreamSanitizer(allowlist, format);
  return trimAnswer(s.push(text) + s.flush(), format);
}

/** Trims a finished answer. Blocks keep a leading "\n- " when the answer opens with a list. */
export function trimAnswer(text: string, format: AnswerFormat = "flat"): string {
  if (format === "flat") return text.trim();
  return text.replace(/^[ \t]+/, "").replace(/^\n(?!- |\d+\. )\s*/, "").replace(/\s+$/, "");
}

/** Blocks-mode inline tidy: like tidy(), but the three separators survive. */
function tidyBlocks(s: string): string {
  return s
    .replace(NO_BREAK, " ")
    .replace(NO_BREAK_HYPHEN, "-")
    .replace(/\s*—\s*/g, ", ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n\n[ \t]+/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1");
}

type Marker = { type: "bullet" | "number"; len: number };

/** What a line starting with `t` is: a list marker, plain text (null), or not decidable yet. */
function classifyLineStart(t: string): Marker | null | "undecided" {
  const bullet = /^[-*•+]/.exec(t);
  if (bullet) {
    if (t.length < 2) return "undecided";
    const m = /^[-*•+][ \t]+/.exec(t);
    return m ? { type: "bullet", len: m[0].length } : null;
  }
  const num = /^\d{1,2}/.exec(t);
  if (num) {
    const after = t.slice(num[0].length);
    if (!after) return num[0].length < 2 ? "undecided" : null;
    if (!/^[.)]/.test(after)) return null;
    if (after.length < 2) return "undecided";
    const m = /^[.)][ \t]+/.exec(after);
    return m ? { type: "number", len: num[0].length + m[0].length } : null;
  }
  return null;
}

/**
 * Blocks-mode structure step, streaming. Decides what every newline means, holding a newline
 * back until the characters after it say: a paragraph break ("\n\n", 3+ newlines become 2), a list
 * item ("\n- ", or "\n1. " renumbered in order; "*", "•" and "+" become "- "), or nothing (a
 * space). Enforces the limits: at most 3 paragraphs (extras merge into the last), one list (later
 * ones become prose), 2–4 items (extras dropped; a lone item becomes prose), no empty items.
 */
export function createBlockShaper(): { push(chunk: string): string; flush(): string } {
  let buf = "";
  let atStart = true;
  let hasContent = false; // anything visible emitted so far
  let paragraphs = 1;
  let lists = 0;
  let list: { type: Marker["type"]; items: number; flatten: boolean; afterText: boolean } | null = null;
  let itemSep: string | null = null; // set while an item's text hasn't arrived yet
  let skipping = false; // inside an item past MAX_ITEMS
  let firstItem: string | null = null; // the first item, held until a second one proves it's a list

  const sepFor = (type: Marker["type"], n: number) => (type === "bullet" ? "\n- " : `\n${n}. `);

  /** Visible text inside the current paragraph or item. */
  const text = (s: string): string => {
    if (!s || skipping) return "";
    if (itemSep !== null) {
      const body = s.replace(/^[ \t]+/, "");
      if (!body) return ""; // still waiting: empty items are dropped
      const l = list!;
      itemSep = null;
      l.items += 1;
      if (l.items > MAX_ITEMS) {
        skipping = true;
        return "";
      }
      if (l.flatten) {
        // A second list in one answer reads as prose: "a, b, c".
        const sep = l.items === 1 ? (l.afterText ? " " : "") : ", ";
        hasContent = true;
        return sep + body;
      }
      const sep = sepFor(l.type, l.items);
      hasContent = true;
      if (l.items === 1) {
        firstItem = sep + body;
        return "";
      }
      const held = firstItem ?? "";
      firstItem = null;
      return held + sep + body;
    }
    if (firstItem !== null) {
      firstItem += s;
      return "";
    }
    if (/\S/.test(s)) hasContent = true;
    return s;
  };

  /** Ends the current list. Returns the lone first item as prose if it never got a second one. */
  const endList = (): { out: string; wasList: boolean } => {
    const wasList = !!list && list.items >= 2 && !list.flatten;
    let out = "";
    if (firstItem !== null) {
      out = firstItem.replace(/^\n(?:- |\d+\. )/, list?.afterText ? " " : "");
      firstItem = null;
    }
    list = null;
    itemSep = null;
    skipping = false;
    return { out, wasList };
  };

  const paragraph = (): string => {
    if (!hasContent) return "";
    paragraphs += 1;
    return paragraphs > MAX_PARAGRAPHS ? " " : "\n\n";
  };

  const item = (type: Marker["type"]): string => {
    if (list) {
      // The next item of the same list (an empty previous item is simply replaced).
      skipping = false;
      itemSep = "";
      return "";
    }
    lists += 1;
    list = { type, items: 0, flatten: lists > 1, afterText: hasContent };
    itemSep = "";
    return "";
  };

  const brk = (paragraphBreak: boolean): string => {
    if (!list) return paragraphBreak ? paragraph() : " ";
    const { out, wasList } = endList();
    // After a real list, new text always starts a new paragraph, or it would read as the last item.
    return out + (wasList || paragraphBreak ? paragraph() : " ");
  };

  const run = (final: boolean): string => {
    let out = "";
    while (buf) {
      if (atStart) {
        const t = buf.replace(/^\s+/, "");
        if (!t) {
          buf = "";
          break;
        }
        const k = classifyLineStart(t);
        if (k === "undecided" && !final) {
          buf = t;
          break;
        }
        atStart = false;
        buf = t;
        if (k && k !== "undecided") {
          buf = buf.slice(k.len);
          out += item(k.type);
        }
        continue;
      }
      const nl = buf.indexOf("\n");
      if (nl === -1) {
        out += text(buf);
        buf = "";
        break;
      }
      out += text(buf.slice(0, nl));
      const ws = /^\s+/.exec(buf.slice(nl))![0];
      const rest = buf.slice(nl + ws.length);
      if (!rest) {
        // Trailing newlines: wait for what follows, or drop them at the end.
        buf = final ? "" : buf.slice(nl);
        break;
      }
      const k = classifyLineStart(rest);
      if (k === "undecided" && !final) {
        buf = buf.slice(nl);
        break;
      }
      buf = rest;
      if (k && k !== "undecided") {
        buf = buf.slice(k.len);
        out += item(k.type);
      } else {
        out += brk((ws.match(/\n/g) ?? []).length >= 2);
      }
    }
    if (final) out += endList().out;
    return out;
  };

  return {
    push(chunk) {
      buf += chunk.replace(/\r\n?/g, "\n");
      return run(false);
    },
    flush() {
      return run(true);
    },
  };
}

// Non-breaking spaces and hyphens (some models write "Hackathon\u202f2025", "runner\u2011up") stop
// the bubble from wrapping where it should. Plain characters wrap normally.
const NO_BREAK = /[\u00a0\u202f\u2007\u2060]/g;
const NO_BREAK_HYPHEN = /\u2011/g;

function tidy(s: string): string {
  return s
    .replace(NO_BREAK, " ")
    .replace(NO_BREAK_HYPHEN, "-")
    // Em dashes read as machine-written; people type commas. En dashes (ranges) are left alone.
    .replace(/\s*—\s*/g, ", ")
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

export function createStreamSanitizer(allowlist: string[], format: AnswerFormat = "flat"): StreamSanitizer {
  const blocks = format === "blocks";
  const shaper = blocks ? createBlockShaper() : null;
  let pending = "";
  let raw = "";
  let atLineStart = true;
  let lastOut = "";

  // A trailing space is held back until we see what follows it, so a removed link or a
  // replaced em dash never leaves a double space or a space before punctuation.
  let started = false;
  let spaceOwed = false;
  const release = (segment: string): string => (blocks ? releaseBlocks(segment) : releaseFlat(segment));
  const releaseFlat = (segment: string): string => {
    const cleaned = tidy(filterLinks(stripMarkup(segment, atLineStart), allowlist));
    atLineStart = /\n\s*$/.test(segment);
    const body = cleaned.trim();
    if (!body) {
      if (started && /\s/.test(cleaned)) spaceOwed = true;
      return "";
    }
    const needsSpace = started && (spaceOwed || /^\s/.test(cleaned)) && !/^[,.;:!?)]/.test(body);
    started = true;
    spaceOwed = /\s$/.test(cleaned);
    return (needsSpace ? " " : "") + body;
  };
  // Same, but only spaces are trimmed, so "\n\n" stays whole. A list marker ("\n- ", "\n1. ") is held
  // until its item has visible text: a token never ends in "\n-", and an item emptied by the link
  // filter disappears instead of showing a lone dash.
  let heldMarker = "";
  const releaseBlocks = (segment: string): string => {
    const cleaned = tidyBlocks(dropLinks(stripMarkup(segment, atLineStart, true), lastOut.slice(-1))).replace(
      /\n(?:-|\d{1,2}\.)[ \t]*(?=\n|$)/g,
      (m, offset: number, whole: string) => (offset + m.length === whole.length ? m : ""),
    );
    atLineStart = /\n\n\s*$/.test(segment);
    let body = cleaned.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
    let marker = "";
    if (heldMarker && body) {
      if (body.startsWith("\n")) heldMarker = ""; // the held item stayed empty: drop it
      else {
        marker = heldMarker;
        heldMarker = "";
      }
    }
    const end = /\n(?:-|\d{1,2}\.)$/.exec(body);
    if (end) {
      heldMarker = end[0] + " ";
      body = body.slice(0, end.index);
    }
    if (!body) {
      if (started && !end && /\s/.test(cleaned)) spaceOwed = true;
      return "";
    }
    const needsSpace =
      !marker && started && (spaceOwed || /^[ \t]/.test(cleaned)) && !/^[\n,.;:!?)]/.test(body) && !/\s$/.test(lastOut);
    started = true;
    spaceOwed = !end && /[ \t]$/.test(cleaned);
    const out = marker + (needsSpace ? " " : "") + body;
    lastOut = out;
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
      pending += shaper ? shaper.push(chunk) : chunk;
      const cut = Math.max(pending.lastIndexOf(" "), pending.lastIndexOf("\n"), pending.lastIndexOf("\t"));
      if (cut === -1) return pending.length > MAX_HOLD ? this.flush() : "";
      let ready = pending.slice(0, cut + 1);
      if (unbalanced(ready) && pending.length <= MAX_HOLD) return "";
      // Blocks: words that may lead into a link ("Read more:", "at") wait for the next word, so
      // they can go with the link.
      if (blocks && pending.length <= MAX_HOLD) {
        const lead = LEAD_IN_TAIL.exec(ready);
        if (lead) ready = ready.slice(0, lead.index);
      }
      if (!ready) return "";
      pending = pending.slice(ready.length);
      return release(ready);
    },
    flush() {
      const rest = pending + (shaper ? shaper.flush() : "");
      pending = "";
      return rest ? release(rest).trimEnd() : "";
    },
  };
}
