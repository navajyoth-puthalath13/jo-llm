// Answer cache in KV. Keys combine the normalised question with a hash of the full system prompt
// (knowledge files + rules) and the action catalog, so editing any of them invalidates cached answers.
// Values are JSON { text, actions }; action ids are resolved at read time, so a label or URL
// edit in content/actions.ts shows up immediately even for cached answers.
//
// Note: the KV free plan allows 1,000 writes a day. Writes only happen on cache misses for
// plain questions, and the global model budget caps those, but keep DAILY_BUDGET at or below it.

export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const contentHashes = new Map<string, Promise<string>>();

/** Memoised per isolate: the system prompt is constant for the life of a deployment. */
export function contentHash(systemPrompt: string): Promise<string> {
  let h = contentHashes.get(systemPrompt);
  if (!h) {
    h = sha256Hex(systemPrompt).then((x) => x.slice(0, 16));
    contentHashes.set(systemPrompt, h);
  }
  return h;
}

/** Flat and block answers never share an entry: the format is part of the key. */
export async function cacheKey(question: string, systemPrompt: string, format: "flat" | "blocks" = "flat"): Promise<string> {
  const [content, q] = await Promise.all([contentHash(systemPrompt), sha256Hex(normalizeQuestion(question))]);
  return format === "flat" ? `ans:${content}:${q.slice(0, 32)}` : `ans:${format}:${content}:${q.slice(0, 32)}`;
}

/** What a cache entry holds. Action ids are resolved against the catalog when read. */
export interface CachedAnswer {
  text: string;
  actions: string[];
}

/** Returns null on a miss, a KV error, or anything that isn't a valid JSON entry (old plain-text values). */
export async function getCached(kv: KVNamespace, key: string): Promise<CachedAnswer | null> {
  let raw: string | null;
  try {
    raw = await kv.get(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CachedAnswer>;
    if (typeof v.text !== "string" || !v.text || !Array.isArray(v.actions)) return null;
    return { text: v.text, actions: v.actions.filter((a): a is string => typeof a === "string") };
  } catch {
    return null;
  }
}

export async function putCached(kv: KVNamespace, key: string, answer: CachedAnswer, ttlSeconds: number): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(answer), { expirationTtl: ttlSeconds });
  } catch {
    // Over the KV write quota or a transient error: caching is best-effort.
  }
}

/**
 * Splits a cached answer into small chunks so the client sees the same token stream as a live answer.
 * A block separator ("\n\n", "\n- ", "\n1. ") always travels with the word after it, never alone.
 */
export function chunkAnswer(answer: string, wordsPerChunk = 2): string[] {
  const words = answer.match(/(?:\n\n|\n- |\n\d{1,2}\. )?\S+[ \t]*/g) ?? [];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) chunks.push(words.slice(i, i + wordsPerChunk).join(""));
  return chunks;
}
