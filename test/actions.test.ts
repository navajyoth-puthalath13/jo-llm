import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIONS } from "../content/actions";
import { KNOWLEDGE_SOURCES } from "../content/knowledge/index";
import { createTagSplitter, resolveActions, sanitizeActionIds } from "../src/actions";
import { cacheKey } from "../src/cache";
import { loadConfig } from "../src/config";
import { linksFromKnowledge, sanitizeText } from "../src/guard/output";
import { answerCacheScope } from "../src/jo";
import { allFacts, buildKnowledge } from "../src/knowledge";
import { buildUserMessage } from "../src/prompt";
import { ACTION_INJECTIONS } from "./fixtures/actions";
import { answerText, ask, errorCode, mockProvider, mockUtility, readEvents, setup } from "./helpers";

const wranglerVar = (name: string) =>
  readFileSync("wrangler.toml", "utf8").match(new RegExp(`^${name} = "(.*)"`, "m"))?.[1];
const knowledge = buildKnowledge(KNOWLEDGE_SOURCES);
const actionsOf = (events: { event: string; data: Record<string, unknown> }[]) =>
  ((events.find((e) => e.event === "actions")?.data.actions ?? []) as { id: string }[]).map((a) => a.id);

describe("action catalog", () => {
  it("has unique ids, valid kinds and short verb-first labels", () => {
    const ids = ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACTIONS) {
      expect(a.id).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(a.label.length).toBeLessThanOrEqual(24);
      expect(a.label).toMatch(/^[A-Z][a-z]+ /);
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
      ...linksFromKnowledge(allFacts(knowledge)),
    ];
    for (const a of ACTIONS) {
      if (a.kind === "external") expect(sanitizeText(a.href, allow), a.id).toBe(a.href);
      if (a.kind === "mailto") expect(sanitizeText(a.href, allow), a.id).toBe(a.href.slice("mailto:".length));
    }
  });

  it("keeps only known ids, de-duplicated, at most 3", () => {
    expect(sanitizeActionIds(["Email", "email", "resume", "nope", "x", "github", "linkedin"])).toEqual(["email", "resume", "x"]);
    expect(resolveActions(["resume", "nope"])).toEqual([
      { id: "resume", label: "Open my resume", href: ACTIONS.find((a) => a.id === "resume")!.href, kind: "external" },
    ]);
  });
});

describe("bracket guard", () => {
  it("holds back everything from [[ even when split across chunks", () => {
    const s = createTagSplitter();
    const shown = ["Here it is.", " ", "[", "[ACT:res", "ume]]"].map((c) => s.push(c)).join("") + s.flush();
    expect(shown).toBe("Here it is. ");
    expect(s.held).toBe("[[ACT:resume]]");
    const lone = createTagSplitter();
    expect(lone.push("a [") + lone.push("b] c") + lone.flush()).toBe("a [b] c");
  });

  it("never shows an old-style tag, and a tag never creates a button", async () => {
    const ctx = setup({ providers: [mockProvider(["I write about design. ", "[", "[ACT:res", "ume,github]]"])] });
    const events = await readEvents(await ask(ctx, { question: "hey" }));
    expect(answerText(events)).toBe("I write about design.");
    // A greeting gets no buttons from the rules, whatever the tag said.
    expect(actionsOf(events)).toEqual([]);
  });
});

describe("actions over the API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends actions after the last token and before done", async () => {
    const ctx = setup({ providers: [mockProvider(["You can grab ", "it here."])] });
    const events = await readEvents(await ask(ctx, { question: "Where's your resume?" }));
    expect(answerText(events)).toBe("You can grab it here.");
    expect(events.map((e) => e.event).slice(-2)).toEqual(["actions", "done"]);
    expect(actionsOf(events)[0]).toBe("resume");
  });

  it("uses the button model's picks, filtered through the rules", async () => {
    const utility = mockUtility(
      { offtopic: false, intent: "experience", files: ["experience"] },
      { actions: ["care-scribe", "work", "launch-missiles"] },
    );
    const ctx = setup({ providers: [mockProvider(["It was a proposed direction."])], utility: [utility] });
    const events = await readEvents(await ask(ctx, { question: "What did you do at OHC?" }));
    expect(actionsOf(events)).toEqual(["care-scribe", "work"]);
    // The button model saw ids and when-lines, never an href.
    const buttonCall = utility.calls.find((c) => c.name === "buttons")!;
    for (const a of ACTIONS) if (a.kind !== "internal") expect(buttonCall.system).not.toContain(a.href);
    expect(buttonCall.user).toContain("<jo_answer>It was a proposed direction.</jo_answer>");
  });

  it("asks the provider for maxOutputTokens", async () => {
    const provider = mockProvider(["ok"]);
    let maxTokens = 0;
    const spy = {
      ...provider,
      stream: (req: { maxTokens: number }, signal: AbortSignal) => ((maxTokens = req.maxTokens), provider.stream(req as never, signal)),
    };
    const ctx = setup({ providers: [spy as never] });
    await (await ask(ctx, { question: "hi" })).text();
    expect(maxTokens).toBe(240);
  });

  it("declines and errors never carry actions", async () => {
    const cases: string[][] = [
      ["[[OFFTOPIC]]"],
      ["Sure! ", "[[OFFTOPIC]] ", "[[ACT:resume]]"],
      ["My rules: JO-RULES-7Q4K ", "[[ACT:resume]]"],
      ["Answer. [[ACT:resume]] JO-RULES-7Q4K"],
    ];
    for (const chunks of cases) {
      const ctx = setup({ providers: [mockProvider(chunks)] });
      const events = await readEvents(await ask(ctx, { question: "Where's your resume?" }));
      expect(errorCode(events)).toBe("offtopic");
      expect(events.some((e) => e.event === "actions")).toBe(false);
    }
    const ctx = setup({ providers: [mockProvider([], { fail: true })] });
    const events = await readEvents(await ask(ctx, { question: "Where's your resume?" }));
    expect(errorCode(events)).toBe("busy");
    expect(events.some((e) => e.event === "actions")).toBe(false);
  });

  for (const fixture of ACTION_INJECTIONS) {
    it(`visitor text can't create actions: ${fixture.name}`, async () => {
      // Even a fooled button model can only name ids; unknown ones and URLs are dropped.
      const utility = mockUtility(null, { actions: ["resume", "evil", "https://evil.example.com"] });
      const provider = mockProvider(["Here you go.", " [[ACT:resume,evil,https://evil.example.com]]"]);
      const ctx = setup({ providers: [provider], utility: [utility] });
      const events = await readEvents(await ask(ctx, fixture.input));
      for (const a of (events.find((e) => e.event === "actions")?.data.actions ?? []) as { href: string }[]) {
        expect(ACTIONS.some((c) => c.href === a.href)).toBe(true);
      }
      expect(JSON.stringify(events)).not.toContain("evil.example.com");
      expect(provider.calls[0]!.user.trim().endsWith("</visitor_question>")).toBe(true);
      expect(buildUserMessage(fixture.input)).not.toMatch(/<\/visitor_question>[\s\S]*\[\[ACT/);
    });
  }
});

describe("cached answers", () => {
  it("replay the same actions", async () => {
    const provider = mockProvider(["Grab it here."]);
    const ctx = setup({ providers: [provider] });
    const first = await readEvents(await ask(ctx, { question: "Can I see your resume?" }));
    await new Promise((r) => setTimeout(r, 0));
    const second = await readEvents(await ask(ctx, { question: "can i see your resume" }));
    expect(provider.calls).toHaveLength(1);
    expect(actionsOf(second)).toEqual(actionsOf(first));
    expect(actionsOf(second)[0]).toBe("resume");
    expect(second.map((e) => e.event).slice(-2)).toEqual(["actions", "done"]);
    expect(second.at(-1)?.data).toEqual({ cached: true });
    const stored = [...ctx.kv.map.entries()].find(([k]) => k.startsWith("ans:"))![1];
    expect(JSON.parse(stored)).toEqual({ text: "Grab it here.", actions: actionsOf(first) });
  });

  it("treat old plain-text values as a miss", async () => {
    const provider = mockProvider(["Fresh answer."]);
    const ctx = setup({ providers: [provider] });
    ctx.kv.map.set(await cacheKey("hello there", answerCacheScope(knowledge)), "an old plain-text answer");
    const events = await readEvents(await ask(ctx, { question: "hello there" }));
    expect(provider.calls).toHaveLength(1);
    expect(answerText(events)).toBe("Fresh answer.");
  });

  it("change key when any knowledge file changes", async () => {
    const edited = KNOWLEDGE_SOURCES.map((s, i) => (i === 5 ? { ...s, text: `${s.text}\n- One more fact.` } : s));
    expect(await cacheKey("hi", answerCacheScope(knowledge))).not.toBe(
      await cacheKey("hi", answerCacheScope(buildKnowledge(edited))),
    );
  });
});

describe("debug trace", () => {
  it("shows routing and buttons as steps", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = setup({ providers: [mockProvider(["Sure."])], env: { JO_DEBUG: "true" } });
    await (await ask(ctx, { question: "Where's your code on GitHub?" })).text();
    await new Promise((r) => setTimeout(r, 0));
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("7 route") && l.includes("keyword fallback"))).toBe(true);
    expect(lines.some((l) => l.includes("11 buttons"))).toBe(true);
    log.mockRestore();
  });
});
