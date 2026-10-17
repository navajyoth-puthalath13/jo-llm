import { describe, expect, it } from "vitest";
import { createStreamSanitizer, sanitizeText } from "../src/guard/output";

const ALLOW = ["navajyoth.com", "www.navajyoth.com", "github.com/navajyoth-puthalath13", "mailto:hello@navajyoth.com"];
const clean = (s: string) => sanitizeText(s, ALLOW);

describe("output sanitizer", () => {
  it("strips markdown", () => {
    expect(clean("I **love** _design_ and `code`.")).toBe("I love _design_ and code.");
    expect(clean("# Hi\n- one\n- two\n> quote")).toBe("Hi one two quote");
    expect(clean("See *this* and 1. that")).toBe("See this and 1. that");
  });

  it("strips HTML", () => {
    expect(clean('Hi <b>there</b><script>alert(1)</script> <img src=x onerror=alert(1)>!')).toBe("Hi therealert(1)!");
  });

  it("keeps allow-listed links and removes others", () => {
    expect(clean("Visit https://navajyoth.com/work for more.")).toBe("Visit https://navajyoth.com/work for more.");
    expect(clean("Code at github.com/navajyoth-puthalath13.")).toBe("Code at github.com/navajyoth-puthalath13.");
    expect(clean("Click https://evil.example.com/x now")).toBe("Click now");
    expect(clean("Try navajyoth.com.evil.io please")).toBe("Try please");
    expect(clean("Not github.com/someoneelse ok")).toBe("Not ok");
  });

  it("turns markdown links into text and filters the URL", () => {
    expect(clean("My [site](https://navajyoth.com) and [this](https://bad.io)")).toBe(
      "My site https://navajyoth.com and this",
    );
  });

  it("allows only the listed email", () => {
    expect(clean("Email hello@navajyoth.com or spam@evil.com.")).toBe("Email hello@navajyoth.com or.");
    expect(clean("Write to mailto:hello@navajyoth.com")).toBe("Write to hello@navajyoth.com");
  });

  it("streams the same result as the one-shot sanitizer, never emitting a partial URL", () => {
    const text = "Hey! Check **my** work at https://evil.example.com/path and [site](https://navajyoth.com) <b>ok</b> done";
    const s = createStreamSanitizer(ALLOW);
    const pieces: string[] = [];
    for (const ch of text.match(/.{1,3}/gs)!) {
      const out = s.push(ch);
      expect(out).not.toMatch(/evil|https:\/\/e/);
      pieces.push(out);
    }
    pieces.push(s.flush());
    expect(pieces.join("")).toBe(clean(text));
  });
});

describe("visible length cap", () => {
  it("stops a runaway answer at about maxTokens * 4 characters", async () => {
    const { generateAnswer } = await import("../src/answer");
    const { mockProvider } = await import("./helpers");
    const words = Array.from({ length: 400 }, () => "word ");
    let sent = "";
    const outcome = await generateAnswer({
      providers: [mockProvider(words)],
      system: "s",
      user: "u",
      maxTokens: 20,
      timeoutsMs: [1000],
      totalTimeoutMs: 5000,
      linkAllowlist: [],
      signal: new AbortController().signal,
      onText: async (t) => void (sent += t),
    });
    expect(outcome.ok).toBe(true);
    expect(sent.length).toBeLessThanOrEqual(80);
    expect(sent.length).toBeGreaterThan(60);
  });
});

describe("links from the knowledge files", () => {
  it("allows every link and email written in the knowledge file", async () => {
    const { linksFromKnowledge } = await import("../src/guard/output");
    const md = "Email: mailto:Me@Example.com\nLinkedIn: https://www.linkedin.com/in/me, X: https://x.com/me.\nSite: https://navajyoth.com/";
    const allow = linksFromKnowledge(md);
    expect(allow).toEqual(expect.arrayContaining(["www.linkedin.com/in/me", "x.com/me", "navajyoth.com", "mailto:me@example.com"]));
    expect(sanitizeText("Reach me at me@example.com or https://x.com/me, not https://x.com/someoneelse", allow)).toBe(
      "Reach me at me@example.com or https://x.com/me, not",
    );
  });
});

describe("em dashes", () => {
  it("turns em dashes into commas, in one go and while streaming", () => {
    expect(clean("feel free to reach out—I'd love that")).toBe("feel free to reach out, I'd love that");
    expect(clean("Jo — short for Navajyoth — designs")).toBe("Jo, short for Navajyoth, designs");
    expect(clean("2021–2025")).toBe("2021–2025");
    const s = createStreamSanitizer(ALLOW);
    const out = ["reach ", "out—I'd ", "love ", "it"].map((c) => s.push(c)).join("") + s.flush();
    expect(out).toBe("reach out, I'd love it");
  });
});

describe("spacing across stream chunks", () => {
  it("never leaves a space before punctuation or a double space", () => {
    const feed = (chunks: string[]) => {
      const s = createStreamSanitizer(ALLOW);
      return chunks.map((c) => s.push(c)).join("") + s.flush();
    };
    expect(feed(["reach ", "out ", "— ", "I'd ", "love ", "it"])).toBe("reach out, I'd love it");
    expect(feed(["see ", "https://evil.example.com ", "and ", "more"])).toBe("see and more");
    expect(feed(["Hello ", "world."])).toBe("Hello world.");
  });
});

describe("a stream that fails mid-answer", () => {
  const run = async (chunks: string[]) => {
    const { generateAnswer } = await import("../src/answer");
    const provider = {
      name: "flaky",
      async *stream() {
        for (const c of chunks) yield c;
        throw new Error("connection reset");
      },
    };
    return generateAnswer({
      providers: [provider],
      system: "s",
      user: "u",
      maxTokens: 240,
      timeoutsMs: [1000],
      totalTimeoutMs: 5000,
      linkAllowlist: [],
      signal: new AbortController().signal,
      onText: async () => {},
    });
  };

  it("becomes busy when it stops mid-sentence", async () => {
    expect(await run(["I'm an AI version of Navajyoth, ", "answering from what he's shared on"])).toMatchObject({ ok: false, code: "busy" });
  });

  it("keeps the answer when it stops after a full sentence", async () => {
    expect(await run(["I'm an AI version of Navajyoth. ", "Email me."])).toMatchObject({ ok: true, text: "I'm an AI version of Navajyoth. Email me." });
  });
});
