import { describe, expect, it } from "vitest";
import { KNOWLEDGE_SOURCES } from "../content/knowledge/index";
import { buildKnowledge } from "../src/knowledge";
import { resolveWhichProjectReply, WHICH_PROJECT, whichProject } from "../src/project-context";
import { MAX_REPLIES, repliesFor } from "../src/replies";

const knowledge = buildKnowledge(KNOWLEDGE_SOURCES);
const asked = [{ q: "What problem were you solving?", a: WHICH_PROJECT }];

describe("reply buttons", () => {
  it("offers the four projects after \"Which project do you mean?\"", () => {
    const replies = repliesFor(WHICH_PROJECT);
    expect(replies.map((r) => r.label)).toEqual(["Appointment scheduling", "CARE Scribe", "System", "Guideline Agent"]);
    for (const r of replies) {
      expect(r.type).toBe("continue_conversation");
      expect(r.label.length).toBeLessThanOrEqual(24);
      // Every label in Jo's question, so the buttons match what it asked.
      expect(WHICH_PROJECT).toContain(r.label);
    }
    expect(replies.length).toBeLessThanOrEqual(MAX_REPLIES);
  });

  it("offers roles when Jo asks what role", () => {
    expect(repliesFor("Happy to tell you! What kind of role are you hiring for?").map((r) => r.label)).toEqual(["Junior product designer", "UX designer"]);
    // Mentioning a role without asking: nothing.
    expect(repliesFor("For that role, I'd bring systems thinking. Email me.")).toEqual([]);
  });

  it("offers nothing for ordinary answers", () => {
    for (const a of ["I'm based in Kerala.", "CARE is a hospital information system.", "How can I help you today?"]) expect(repliesFor(a)).toEqual([]);
  });

  it("every project reply turns into the earlier question about that project", () => {
    for (const r of repliesFor(WHICH_PROJECT)) {
      const next = resolveWhichProjectReply(knowledge, { question: r.message, history: asked });
      expect(next.question, r.label).toBe(`What problem were you solving? (${r.label})`);
      expect(next.history).toBeUndefined();
      // …and Jo doesn't ask "which project?" again.
      expect(whichProject(knowledge, next), r.label).toBeNull();
    }
  });

  it("works for typed replies, keeps earlier history, and leaves other messages alone", () => {
    const before = { q: "hi", a: "Hey! How can I help you today?" };
    const next = resolveWhichProjectReply(knowledge, { question: "the scheduling one", history: [before, ...asked], page: "/", format: "blocks" });
    expect(next).toEqual({ question: "What problem were you solving? (Appointment scheduling)", history: [before], page: "/", format: "blocks" });

    const full = { question: "What did you learn from CARE Scribe?", history: asked };
    expect(resolveWhichProjectReply(knowledge, full)).toBe(full);
    const other = { question: "never mind, how can I contact you?", history: asked };
    expect(resolveWhichProjectReply(knowledge, other)).toBe(other);
    const noHistory = { question: "System" };
    expect(resolveWhichProjectReply(knowledge, noHistory)).toBe(noHistory);
  });
});

describe("reply buttons over the API", () => {
  it("streams replies after the which-project question, then answers the tapped reply", async () => {
    const { answerText, ask, mockProvider, mockUtility, readEvents, setup } = await import("./helpers");
    const provider = mockProvider(["I was fixing fractional slot errors."]);
    const utility = mockUtility({ offtopic: false, intent: "project", files: ["appointment-scheduling"] }, { actions: [] });
    const ctx = setup({ providers: [provider], utility: [utility] });

    const first = await readEvents(await ask(ctx, { question: "What problem were you solving?", format: "blocks" }));
    expect(answerText(first)).toBe(WHICH_PROJECT);
    const names = first.map((e) => e.event);
    expect(names.indexOf("replies")).toBeGreaterThan(names.lastIndexOf("token"));
    expect(names.indexOf("replies")).toBeLessThan(names.indexOf("done"));
    expect(first.find((e) => e.event === "done")?.data).toMatchObject({ awaitingReply: true });
    const replies = first.find((e) => e.event === "replies")!.data.replies as { label: string; message: string }[];
    expect(replies).toHaveLength(4);

    const second = await readEvents(
      await ask(ctx, { question: replies[0]!.message, format: "blocks", history: [{ q: "What problem were you solving?", a: WHICH_PROJECT }] }),
    );
    expect(answerText(second)).toBe("I was fixing fractional slot errors.");
    expect(second.some((e) => e.event === "replies")).toBe(false);
    const buttons = (second.find((e) => e.event === "actions")?.data.actions as { id: string }[]).map((a) => a.id);
    expect(buttons).toEqual(["appointment-scheduling", "all-work"]);
  });
});
