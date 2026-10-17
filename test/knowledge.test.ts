import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "../content/actions";
import { KNOWLEDGE_FILES } from "../content/knowledge/files";
import { KNOWLEDGE_SOURCES } from "../content/knowledge/index";
import { buildKnowledge, factLines, parseKnowledgeFile, renderKnowledge } from "../src/knowledge";

const DIR = "content/knowledge";
const listMd = (dir: string, prefix = ""): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listMd(full, `${prefix}${name}/`);
    return name.endsWith(".md") && name !== "README.md" ? [`${prefix}${name}`] : [];
  });

const file = (path: string, front: string, body = "- a fact") => ({ path, text: `---\n${front}\n---\n\n${body}\n` });
const front = (id: string, extra = "actions: []") => `id: ${id}\ntitle: T\ncovers: c\nkeywords: [k]\n${extra}`;

describe("knowledge files", () => {
  it("files.ts, index.ts and the folder list the same files in the same order", () => {
    expect(KNOWLEDGE_SOURCES.map((s) => s.path)).toEqual([...KNOWLEDGE_FILES]);
    expect([...listMd(DIR)].sort()).toEqual([...KNOWLEDGE_FILES].sort());
  });

  it("all parse, with unique ids and catalog actions", () => {
    const k = buildKnowledge(KNOWLEDGE_SOURCES);
    expect(k.files).toHaveLength(KNOWLEDGE_FILES.length);
    const catalog = new Set(ACTIONS.map((a) => a.id));
    for (const f of k.files) for (const a of f.actions) expect(catalog.has(a), `${f.path}: ${a}`).toBe(true);
    expect(k.files.filter((f) => f.always).map((f) => f.id)).toEqual(["voice", "boundaries", "about", "contact"]);
  });

  it("fails on a duplicate id", () => {
    expect(() => buildKnowledge([file("a.md", front("same")), file("b.md", front("same"))])).toThrow(/duplicate id/);
  });

  it("fails on missing frontmatter or a missing key", () => {
    expect(() => parseKnowledgeFile({ path: "x.md", text: "- just facts" })).toThrow(/missing frontmatter/);
    expect(() => parseKnowledgeFile(file("x.md", "id: x\ntitle: T\ncovers: c\nkeywords: []"))).toThrow(/"actions"/);
  });

  it("fails on an action that isn't in the catalog", () => {
    expect(() => buildKnowledge([file("a.md", front("a", "actions: [launch-rockets]"))])).toThrow(/not in content\/actions.ts/);
  });

  it("accepts the README template's inline comment", () => {
    const f = parseKnowledgeFile(file("a.md", front("a", "actions: [care-scribe]        # related buttons")));
    expect(f.actions).toEqual(["care-scribe"]);
  });

  it("never passes TODO lines, comments or headings to the model", () => {
    expect(factLines("- fact\n- TODO: check this\n<!-- note -->\n## Heading\n- other")).toBe("- fact\n- other");
    const k = buildKnowledge(KNOWLEDGE_SOURCES);
    expect(renderKnowledge(k, k.routable.map((f) => f.id))).not.toMatch(/TODO|<!--/);
  });

  it("has no ReviewFlow anywhere", () => {
    for (const s of KNOWLEDGE_SOURCES) expect(s.text.toLowerCase()).not.toContain("reviewflow");
    expect(JSON.stringify(ACTIONS).toLowerCase()).not.toContain("reviewflow");
  });

  it("renders always-files plus routed files in the stable order", () => {
    const k = buildKnowledge(KNOWLEDGE_SOURCES);
    const out = renderKnowledge(k, ["care-scribe", "system"]);
    const order = ["How I sound", "What I won't discuss", "About me", "How to reach me", "### System", "### CARE Scribe"];
    const positions = order.map((t) => out.indexOf(t));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(out).not.toContain("Guideline Agent");
  });

  it("README documents the template", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    for (const key of ["id:", "covers:", "keywords:", "actions:", "TODO:", "files.ts", "index.ts"]) expect(readme).toContain(key);
  });
});

describe("eval fixtures", () => {
  it("only reference real files and buttons", async () => {
    const { EVAL_CASES } = await import("./fixtures/eval");
    const k = buildKnowledge(KNOWLEDGE_SOURCES);
    const catalog = new Set(ACTIONS.map((a) => a.id));
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(30);
    for (const c of EVAL_CASES) {
      for (const f of c.files ?? []) expect(k.routable.some((r) => r.id === f), `${c.name}: ${f}`).toBe(true);
      for (const b of c.buttons ?? []) expect(catalog.has(b), `${c.name}: ${b}`).toBe(true);
    }
  });
});
