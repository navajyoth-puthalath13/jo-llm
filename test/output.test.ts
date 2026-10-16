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
