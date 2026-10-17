// Jo's knowledge: small markdown files with frontmatter (content/knowledge/). Parsed once per
// isolate. Runtime-agnostic: the Worker passes bundled text, Node scripts pass text read from disk.

import { ACTIONS } from "../content/actions";

export interface KnowledgeSource {
  path: string;
  text: string;
}

export interface KnowledgeFile {
  id: string;
  path: string;
  title: string;
  covers: string;
  keywords: string[];
  actions: string[];
  /** Always in the prompt (voice, boundaries, about, contact). */
  always: boolean;
  /** Fact lines only: TODO lines, comments and blank lines removed. */
  facts: string;
}

export interface Knowledge {
  files: KnowledgeFile[];
  byId: Map<string, KnowledgeFile>;
  /** Files that can be routed to (everything not `always`). */
  routable: KnowledgeFile[];
  /** Changes whenever any file changes. Part of the answer cache key. */
  fingerprint: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const ID_RE = /^[a-z0-9-]{1,40}$/;

function parseList(raw: string, where: string): string[] {
  const m = /^\[(.*)\]$/.exec(raw.trim());
  if (!m) throw new Error(`${where}: expected a [list]`);
  return m[1]!
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter(Boolean);
}

/** TODO lines, HTML comments and headings are never facts, so they never reach the model. */
export function factLines(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => line.trim() && !/TODO:/i.test(line) && !/^\s*#/.test(line))
    .join("\n")
    .trim();
}

export function parseKnowledgeFile(source: KnowledgeSource): KnowledgeFile {
  const text = source.text.replace(/\r\n/g, "\n");
  const m = FRONTMATTER_RE.exec(text);
  if (!m) throw new Error(`${source.path}: missing frontmatter`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    if (!line.trim()) continue;
    const i = line.indexOf(":");
    if (i < 1) throw new Error(`${source.path}: bad frontmatter line "${line}"`);
    // Allow trailing "# comments" after a value, like the template in content/knowledge/README.md.
    meta[line.slice(0, i).trim()] = line.slice(i + 1).replace(/\s+#.*$/, "").trim();
  }
  for (const key of ["id", "title", "covers", "keywords", "actions"]) {
    if (meta[key] === undefined) throw new Error(`${source.path}: frontmatter is missing "${key}"`);
  }
  const id = meta.id!;
  if (!ID_RE.test(id)) throw new Error(`${source.path}: id "${id}" must be lowercase letters, digits and hyphens`);
  return {
    id,
    path: source.path,
    title: meta.title!,
    covers: meta.covers!,
    keywords: parseList(meta.keywords!, `${source.path} keywords`),
    actions: parseList(meta.actions!, `${source.path} actions`),
    always: meta.always === "true",
    facts: factLines(m[2]!),
  };
}

const CATALOG_IDS = new Set(ACTIONS.map((a) => a.id));

/** Parses and validates every file. Throws on duplicate ids, missing frontmatter or unknown actions. */
export function buildKnowledge(sources: KnowledgeSource[]): Knowledge {
  const files = sources.map(parseKnowledgeFile);
  const byId = new Map<string, KnowledgeFile>();
  for (const f of files) {
    if (byId.has(f.id)) throw new Error(`${f.path}: duplicate id "${f.id}" (also in ${byId.get(f.id)!.path})`);
    for (const a of f.actions) {
      if (!CATALOG_IDS.has(a)) throw new Error(`${f.path}: action "${a}" is not in content/actions.ts`);
    }
    byId.set(f.id, f);
  }
  return {
    files,
    byId,
    routable: files.filter((f) => !f.always),
    fingerprint: sources.map((s) => `${s.path}\n${s.text}`).join("\n\u0000\n"),
  };
}

/** Renders the chosen files for the prompt, always-files first, then in the stable file order. */
export function renderKnowledge(knowledge: Knowledge, routedIds: string[]): string {
  const wanted = new Set(routedIds);
  return knowledge.files
    .filter((f) => f.always || wanted.has(f.id))
    .filter((f) => f.facts)
    .map((f) => `### ${f.title}\n${f.facts}`)
    .join("\n\n");
}

/** Everything the model may see, for building the link allowlist. */
export function allFacts(knowledge: Knowledge): string {
  return knowledge.files.map((f) => f.facts).join("\n");
}
