// Answer cache in KV. Keys combine the normalised question with a hash of jo.md, so editing
// jo.md invalidates every cached answer automatically.
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

/** Memoised per isolate: jo.md is constant for the life of a deployment. */
export function contentHash(joMd: string): Promise<string> {
  let h = contentHashes.get(joMd);
  if (!h) {
    h = sha256Hex(joMd).then((x) => x.slice(0, 16));
    contentHashes.set(joMd, h);
  }
  return h;
}

export async function cacheKey(question: string, joMd: string): Promise<string> {
  const [content, q] = await Promise.all([contentHash(joMd), sha256Hex(normalizeQuestion(question))]);
  return `ans:${content}:${q.slice(0, 32)}`;
}

export async function getCached(kv: KVNamespace, key: string): Promise<string | null> {
  try {
    return await kv.get(key);
  } catch {
    return null;
  }
}

export async function putCached(kv: KVNamespace, key: string, answer: string, ttlSeconds: number): Promise<void> {
  try {
    await kv.put(key, answer, { expirationTtl: ttlSeconds });
  } catch {
    // Over the KV write quota or a transient error: caching is best-effort.
  }
}

/** Splits a cached answer into small chunks so the client sees the same token stream as a live answer. */
export function chunkAnswer(answer: string, wordsPerChunk = 2): string[] {
  const words = answer.match(/\S+\s*/g) ?? [];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) chunks.push(words.slice(i, i + wordsPerChunk).join(""));
  return chunks;
}
