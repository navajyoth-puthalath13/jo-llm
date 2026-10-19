import { describe, expect, it } from "vitest";
import { createStreamSanitizer, sanitizeText } from "../src/guard/output";

const ALLOW = ["navajyoth.com", "www.navajyoth.com", "github.com/navajyoth-puthalath13", "mailto:hello@navajyoth.com"];
const blocks = (s: string) => sanitizeText(s, ALLOW, "blocks");
const flat = (s: string) => sanitizeText(s, ALLOW);

/** Streams `text` in pieces of `size` characters and joins what comes out. */
function streamed(text: string, size: number): { out: string; tokens: string[] } {
  const s = createStreamSanitizer(ALLOW, "blocks");
  const tokens: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    const t = s.push(text.slice(i, i + size));
    if (t) tokens.push(t);
  }
  const end = s.flush();
  if (end) tokens.push(end);
  return { out: tokens.join("").replace(/\s+$/, ""), tokens };
}

describe("blocks format: allowed structure", () => {
  it("keeps paragraphs, bullets and numbered items", () => {
    expect(blocks("I'm in Kerala.\n\nSay hi anytime.")).toBe("I'm in Kerala.\n\nSay hi anytime.");
    expect(blocks("Reach me here:\n- Email\n- LinkedIn\n- X")).toBe("Reach me here:\n- Email\n- LinkedIn\n- X");
    expect(blocks("My process:\n1. Understand\n2. Map\n3. Prototype")).toBe("My process:\n1. Understand\n2. Map\n3. Prototype");
  });

  it("turns stray single newlines into spaces and 3+ newlines into one paragraph break", () => {
    expect(blocks("I design\nthings.")).toBe("I design things.");
    expect(blocks("One.\n\n\n\nTwo.")).toBe("One.\n\nTwo.");
  });

  it("normalizes *, • and + bullets, and renumbers", () => {
    expect(blocks("Ways:\n* Email\n• LinkedIn\n+ X")).toBe("Ways:\n- Email\n- LinkedIn\n- X");
    expect(blocks("Steps:\n3. One\n7) Two\n1. Three")).toBe("Steps:\n1. One\n2. Two\n3. Three");
  });

  it("strips headings, bold, code and quotes", () => {
    expect(blocks("# Projects\n\n**System** is `mine`.\n\n> quoted")).toBe("Projects\n\nSystem is mine.\n\nquoted");
  });

  it("keeps at most 4 items", () => {
    expect(blocks("Projects:\n- A\n- B\n- C\n- D\n- E\n- F")).toBe("Projects:\n- A\n- B\n- C\n- D");
  });

  it("flattens nested and later lists into prose", () => {
    expect(blocks("First:\n- A\n- B\n\nAlso:\n- C\n- D")).toBe("First:\n- A\n- B\n\nAlso: C, D");
    // An indented "nested" item is just another item.
    expect(blocks("List:\n- A\n  - A1\n- B")).toBe("List:\n- A\n- A1\n- B");
  });

  it("keeps at most 3 paragraphs, merging the rest into the last", () => {
    expect(blocks("One.\n\nTwo.\n\nThree.\n\nFour.")).toBe("One.\n\nTwo.\n\nThree. Four.");
  });

  it("turns a one-item list into prose and drops empty items", () => {
    expect(blocks("My pick:\n- System\n\nIt's live.")).toBe("My pick: System\n\nIt's live.");
    expect(blocks("Ways:\n- \n- Email\n-   \n- X")).toBe("Ways:\n- Email\n- X");
  });

  it("starts a new paragraph after a list, even after a single newline", () => {
    expect(blocks("Reach me:\n- Email\n- X\nI reply fast.")).toBe("Reach me:\n- Email\n- X\n\nI reply fast.");
  });

  it("keeps a list that opens the answer", () => {
    expect(blocks("- System\n- CARE Scribe")).toBe("\n- System\n- CARE Scribe");
  });

  it("does not treat a hyphenated word or a year as a list", () => {
    expect(blocks("It was\n-ish done in\n2025. Then more.")).toBe("It was -ish done in 2025. Then more.");
  });

  it("turns non-breaking spaces and hyphens into plain ones, so the bubble can wrap", () => {
    expect(blocks("First Prize, UI Alchemist Hackathon\u202f2025 and runner\u2011up.")).toBe("First Prize, UI Alchemist Hackathon 2025 and runner-up.");
    expect(flat("Hackathon\u00a02025, runner\u2011up")).toBe("Hackathon 2025, runner-up");
  });

  it("still filters links and em dashes", () => {
    expect(blocks("Find me:\n- https://evil.example.com\n- navajyoth.com — anytime")).toBe("Find me:\n- navajyoth.com, anytime");
  });
});

describe("blocks format: streaming", () => {
  const text = "Reach me here:\n- Email at hello@navajyoth.com\n- LinkedIn\n- X\n\nI reply fast.";
  const expected = "Reach me here:\n- Email at hello@navajyoth.com\n- LinkedIn\n- X\n\nI reply fast.";

  it("gives the same result whatever the chunk size", () => {
    for (const size of [1, 2, 3, 5, 7, 13, 100]) expect(streamed(text, size).out, `chunks of ${size}`).toBe(expected);
  });

  it("never ends a token with a bare newline or a half marker", () => {
    for (const size of [1, 2, 3]) {
      for (const t of streamed(text, size).tokens) {
        expect(t, JSON.stringify(t)).not.toMatch(/(^|[^\n])\n$/);
        expect(t, JSON.stringify(t)).not.toMatch(/\n-$/);
        expect(t, JSON.stringify(t)).not.toMatch(/\n\d+\.?$/);
      }
    }
  });

  it("holds a trailing newline until the next characters decide", () => {
    const s = createStreamSanitizer(ALLOW, "blocks");
    let out = s.push("Ways:\n");
    out += s.push("-");
    expect(out).not.toContain("\n");
    out += s.push(" Email\n- X") + s.flush();
    expect(out).toBe("Ways:\n- Email\n- X");
  });
});

describe("flat format is unchanged", () => {
  it("collapses everything to one line, as before", () => {
    expect(flat("# Hi\n- one\n- two\n> quote")).toBe("Hi one two quote");
    expect(flat("One.\n\nTwo.")).toBe("One. Two.");
    expect(flat("Ways:\n1. Email\n2. X")).toBe("Ways: Email X");
  });
});

describe("blocks format: request, prompt and cache", () => {
  it("accepts format: blocks, rejects anything else", async () => {
    const { parseAsk } = await import("../src/guard/validate");
    expect(parseAsk(JSON.stringify({ question: "hi", format: "blocks" }))?.format).toBe("blocks");
    expect(parseAsk(JSON.stringify({ question: "hi" }))?.format).toBeUndefined();
    expect(parseAsk(JSON.stringify({ question: "hi", format: "markdown" }))).toBeNull();
    expect(parseAsk(JSON.stringify({ question: "hi", format: "flat" }))).toBeNull();
  });

  it("gives each format its own rules", async () => {
    const { buildSystemPrompt } = await import("../src/prompt");
    const flatPrompt = buildSystemPrompt("facts");
    const blockPrompt = buildSystemPrompt("facts", "blocks");
    expect(flatPrompt).toContain("one paragraph with no line breaks");
    expect(flatPrompt).not.toContain('starting with "- "');
    expect(blockPrompt).toContain('starting with "- "');
    for (const p of [flatPrompt, blockPrompt]) {
      expect(p).toContain("small talk up to 12 words");
      expect(p).toContain("Don't write out web addresses");
    }
    expect(blockPrompt).toContain("Two items is enough for a list");
  });

  it("keys the cache by format", async () => {
    const { cacheKey } = await import("../src/cache");
    expect(await cacheKey("hi", "v1", "blocks")).not.toBe(await cacheKey("hi", "v1"));
    expect(await cacheKey("hi", "v1", "flat")).toBe(await cacheKey("hi", "v1"));
  });

  it("streams cached block answers with separators attached to the next word", async () => {
    const { chunkAnswer } = await import("../src/cache");
    const text = "Reach me:\n- Email\n- X\n\nI reply fast.";
    const chunks = chunkAnswer(text, 1);
    expect(chunks.join("")).toBe(text);
    for (const c of chunks) expect(c).not.toMatch(/\n-?$/);
    expect(chunks).toContain("\n- Email");
  });
});

describe("blocks format: answer checks", () => {
  const run = async (chunks: string[], maxTokens = 240) => {
    const { generateAnswer } = await import("../src/answer");
    const { mockProvider } = await import("./helpers");
    let streamedText = "";
    const outcome = await generateAnswer({
      providers: [mockProvider(chunks)],
      system: "s",
      user: "u",
      maxTokens,
      timeoutsMs: [1000],
      totalTimeoutMs: 5000,
      linkAllowlist: ALLOW,
      format: "blocks",
      signal: new AbortController().signal,
      onText: async (t) => void (streamedText += t),
    });
    return { outcome, streamedText };
  };

  it("strips a filler opener, live and saved", async () => {
    const { outcome, streamedText } = await run(["Great question! ", "I'm based ", "in Kerala."]);
    expect(outcome).toMatchObject({ ok: true, text: "I'm based in Kerala." });
    expect(streamedText).toBe("I'm based in Kerala.");
    expect((await run(["So, ", "I design ", "things."])).outcome).toMatchObject({ text: "I design things." });
    // "So" inside a sentence is fine.
    expect((await run(["I think so, yes."])).outcome).toMatchObject({ text: "I think so, yes." });
  });

  it("drops an exact repeated sentence from the saved answer", async () => {
    const { outcome } = await run(["I'm based in Kerala. ", "I love design. ", "I'm based in Kerala."]);
    expect(outcome).toMatchObject({ ok: true, text: "I'm based in Kerala. I love design." });
  });

  it("trims to the last full list item at the length cap, never mid-item", async () => {
    const items = Array.from({ length: 4 }, (_, i) => `\n- Item number ${i + 1} with quite a few words in it`);
    const { outcome } = await run(["Here they are:", ...items], 30); // cap: 120 characters
    expect(outcome.ok).toBe(true);
    const text = (outcome as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text).toMatch(/in it$/);
  });

  it("keeps structure in the saved answer", async () => {
    const { outcome } = await run(["Reach me here:\n", "- Email\n", "- LinkedIn\n", "- X"]);
    expect(outcome).toMatchObject({ ok: true, text: "Reach me here:\n- Email\n- LinkedIn\n- X" });
  });
});
