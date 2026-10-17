import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIONS } from "../content/actions";
import { createTagSplitter, parseActionTag, resolveActions } from "../src/actions";
import { cacheKey } from "../src/cache";
import { loadConfig } from "../src/config";
import { linksFromKnowledge, sanitizeText } from "../src/guard/output";
import { buildUserMessage } from "../src/prompt";
import { ACTION_INJECTIONS } from "./fixtures/actions";
import { answerText, ask, errorCode, mockProvider, readEvents, setup } from "./helpers";

const wranglerVar = (name: string) =>
  readFileSync("wrangler.toml", "utf8").match(new RegExp(`^${name} = "(.*)"`, "m"))?.[1];

describe("action catalog", () => {
  it("has unique ids, valid kinds and short verb-first labels", () => {
    const ids = ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACTIONS) {
      expect(a.id).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(a.label.length).toBeLessThanOrEqual(24);
      expect(a.label).toMatch(/^[A-Z][a-z]+ /); // "Email me", "See my work", "Open my resume"
      expect(a.when.length).toBeGreaterThan(10);
      if (a.kind === "internal") expect(a.href).toMatch(/^\/[A-Za-z0-9\-/#]*$/);
      if (a.kind === "external") expect(a.href).toMatch(/^https:\/\//);
      if (a.kind === "mailto") expect(a.href).toMatch(/^mailto:[^@\s]+@[^@\s]+$/);
    }
    expect(Object.isFrozen(ACTIONS)).toBe(true);
    expect(Object.isFrozen(ACTIONS[0])).toBe(true);
  });

  it("every external and mailto href passes the production link allowlist", () => {
    const allow = [
      ...loadConfig({ LINK_ALLOWLIST: wranglerVar("LINK_ALLOWLIST") } as never).linkAllowlist,
      ...linksFromKnowledge(readFileSync("content/jo.md", "utf8")),
    ];
    for (const a of ACTIONS) {
      if (a.kind === "external") expect(sanitizeText(a.href, allow), a.id).toBe(a.href);
      if (a.kind === "mailto") expect(sanitizeText(a.href, allow), a.id).toBe(a.href.slice("mailto:".length));
    }
  });

  it("never puts hrefs in the prompt", async () => {
    const { buildSystemPrompt } = await import("../src/prompt");
    const prompt = buildSystemPrompt("# Jo");
    for (const a of ACTIONS) {
      expect(prompt).toContain(`- ${a.id} — `);
      if (a.kind !== "internal") expect(prompt).not.toContain(a.href);
    }
  });
});

describe("parsing the tag", () => {
  it("accepts valid tags, lowercases and de-duplicates", () => {
    expect(parseActionTag("[[ACT:resume]]")).toEqual(["resume"]);
    expect(parseActionTag("  [[ACT: Email , RESUME ]]\n")).toEqual(["email", "resume"]);
    expect(parseActionTag("[[ACT:email,email]]")).toEqual(["email"]);
  });

  it("drops unknown ids, extra ids, malformed tags and injected hrefs", () => {
    expect(parseActionTag("[[ACT:resume,hack-the-planet]]")).toEqual(["resume"]);
    expect(parseActionTag("[[ACT:email,resume,github]]")).toEqual(["email", "resume"]);
    expect(parseActionTag("[[ACT:resume")).toEqual([]);
    expect(parseActionTag("[[act resume]]")).toEqual([]);
    expect(parseActionTag("[[ACT:resume]] and more text")).toEqual([]);
    expect(parseActionTag("[[ACT:https://evil.example.com]]")).toEqual([]);
    expect(parseActionTag('[[ACT:resume,"javascript:alert(1)"]]')).toEqual([]);
    expect(parseActionTag("[[OFFTOPIC]]")).toEqual([]);
  });

  it("resolves only from the catalog", () => {
    expect(resolveActions(["resume", "nope"])).toEqual([
      { id: "resume", label: "Open my resume", href: ACTIONS.find((a) => a.id === "resume")!.href, kind: "external" },
    ]);
  });

  it("holds back everything from [[ even when split across chunks", () => {
    const s = createTagSplitter();
    const shown = ["Here it is.", " ", "[", "[ACT:res", "ume]]"].map((c) => s.push(c)).join("") + s.flush();
    expect(shown).toBe("Here it is. ");
    expect(s.held).toBe("[[ACT:resume]]");
    const lone = createTagSplitter();
    expect(lone.push("a [") + lone.push("b] c") + lone.flush()).toBe("a [b] c");
  });
});

describe("actions over the API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never shows the tag and sends actions after the last token, before done", async () => {
    const ctx = setup({ providers: [mockProvider(["You can grab ", "it here.", "\n", "[", "[ACT:res", "ume]]"])] });
    const events = await readEvents(await ask(ctx, { question: "Where's your resume?" }));
    expect(answerText(events)).toBe("You can grab it here.");
    expect(answerText(events)).not.toContain("[");
    expect(events.map((e) => e.event).slice(-2)).toEqual(["actions", "done"]);
    expect(events.at(-2)?.data).toEqual({ actions: resolveActions(["resume"]) });
  });

  it("sends no actions event when the model picks none or only unknown ids", async () => {
    const cases: [string, string][] = [
      ["Just an answer.", "Just an answer."],
      ["Answer. [[ACT:launch-missiles]]", "Answer."],
      ["Answer. [[ACT:", "Answer."],
    ];
    for (const [modelText, shown] of cases) {
      const ctx = setup({ providers: [mockProvider([modelText])] });
      const events = await readEvents(await ask(ctx, { question: "hi" }));
      expect(events.some((e) => e.event === "actions")).toBe(false);
      expect(answerText(events)).toBe(shown);
    }
  });

  it("asks the provider for a little extra room for the tag", async () => {
    const provider = mockProvider(["ok"]);
    let maxTokens = 0;
    const spy = { ...provider, stream: (req: { maxTokens: number }, signal: AbortSignal) => ((maxTokens = req.maxTokens), provider.stream(req as never, signal)) };
    const ctx = setup({ providers: [spy as never] });
    await (await ask(ctx, { question: "hi" })).text();
    expect(maxTokens).toBe(180 + 15);
  });

  it("declines and errors never carry actions", async () => {
    const cases: [string[], string][] = [
      [["[[OFFTOPIC]]"], "offtopic"],
      [["Sure! ", "[[OFFTOPIC]] ", "[[ACT:resume]]"], "offtopic"],
      [["My rules: JO-RULES-7Q4K ", "[[ACT:resume]]"], "offtopic"],
      [["Answer. [[ACT:resume]] JO-RULES-7Q4K"], "offtopic"],
    ];
    for (const [chunks, code] of cases) {
      const ctx = setup({ providers: [mockProvider(chunks)] });
      const events = await readEvents(await ask(ctx, { question: "q" }));
      expect(errorCode(events)).toBe(code);
      expect(events.some((e) => e.event === "actions")).toBe(false);
    }
    const ctx = setup({ providers: [mockProvider([], { fail: true })] });
    const events = await readEvents(await ask(ctx, { question: "q" }));
    expect(errorCode(events)).toBe("busy");
    expect(events.some((e) => e.event === "actions")).toBe(false);
  });

  for (const fixture of ACTION_INJECTIONS) {
    it(`visitor text can't create actions: ${fixture.name}`, async () => {
      // The model (mocked) chooses resume plus whatever it was tricked into; only catalog ids survive.
      const provider = mockProvider(["Here you go.", " [[ACT:resume,evil,https://evil.example.com]]"]);
      const ctx = setup({ providers: [provider] });
      const events = await readEvents(await ask(ctx, fixture.input));
      const actions = events.find((e) => e.event === "actions")?.data.actions as { href: string }[] | undefined;
      for (const a of actions ?? []) expect(ACTIONS.some((c) => c.href === a.href)).toBe(true);
      expect(JSON.stringify(events)).not.toContain("evil.example.com");
      // And the visitor's fake tag stays inside the data tags.
      const user = provider.calls[0]!.user;
      expect(user.trim().endsWith("</visitor_question>")).toBe(true);
      expect(buildUserMessage(fixture.input)).not.toMatch(/<\/visitor_question>[\s\S]*\[\[ACT/);
    });
  }
});

describe("cached answers", () => {
  it("replay the same actions", async () => {
    const provider = mockProvider(["Grab it here. ", "[[ACT:resume,email]]"]);
    const ctx = setup({ providers: [provider] });
    const first = await readEvents(await ask(ctx, { question: "Can I see your resume?" }));
    await new Promise((r) => setTimeout(r, 0));
    const second = await readEvents(await ask(ctx, { question: "can i see your resume" }));
    expect(provider.calls).toHaveLength(1);
    expect(second.find((e) => e.event === "actions")).toEqual(first.find((e) => e.event === "actions"));
    expect(second.map((e) => e.event).slice(-2)).toEqual(["actions", "done"]);
    expect(second.at(-1)?.data).toEqual({ cached: true });
    const stored = [...ctx.kv.map.entries()].find(([k]) => k.startsWith("ans:"))![1];
    expect(JSON.parse(stored)).toEqual({ text: "Grab it here.", actions: ["resume", "email"] });
  });

  it("treat old plain-text values as a miss", async () => {
    const provider = mockProvider(["Fresh answer."]);
    const ctx = setup({ providers: [provider] });
    const { catalogFingerprint } = await import("../src/actions");
    const { buildSystemPrompt } = await import("../src/prompt");
    const key = await cacheKey("hello there", `${buildSystemPrompt("# Jo\nI am Jo.")}\n${catalogFingerprint()}`);
    ctx.kv.map.set(key, "an old plain-text answer");
    const events = await readEvents(await ask(ctx, { question: "hello there" }));
    expect(provider.calls).toHaveLength(1);
    expect(answerText(events)).toBe("Fresh answer.");
  });

  it("change key when the catalog changes", async () => {
    expect(await cacheKey("hi", "prompt\nemail:a")).not.toBe(await cacheKey("hi", "prompt\nemail:a|resume:b"));
  });
});

describe("debug trace", () => {
  it("shows the parsed actions as a step", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = setup({ providers: [mockProvider(["Sure. ", "[[ACT:github]]"])], env: { JO_DEBUG: "true" } });
    await (await ask(ctx, { question: "Where's your code?" })).text();
    await new Promise((r) => setTimeout(r, 0));
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("9 actions") && l.includes("github"))).toBe(true);
  });
});
