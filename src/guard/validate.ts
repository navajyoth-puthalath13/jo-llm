import { z } from "zod";

// Control characters, zero-width characters, bidi overrides/isolates, BOM, soft hyphen.
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** NFKC-normalise, drop invisible/control characters, collapse whitespace. */
export function cleanText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\t\n\r\f\v]/g, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
}

const truncated = (max: number) =>
  z
    .string()
    .max(8192)
    .transform((s) => cleanText(s).slice(0, max));

export const AskSchema = z
  .object({
    question: z
      .string()
      .max(4096)
      .transform(cleanText)
      .pipe(z.string().min(1).max(300)),
    quote: truncated(1000).optional(),
    page: z
      .string()
      .max(100)
      .regex(/^\/[A-Za-z0-9\-._~%/]*$/)
      .optional(),
    history: z
      // Jo's answers are capped at ~720 characters, so 600 keeps nearly all of each one.
      .array(z.object({ q: truncated(300), a: truncated(600) }).strict())
      .max(20)
      .transform((h) => h.slice(-6))
      .optional(),
  })
  .strict();

export type AskInput = z.output<typeof AskSchema>;

/** Reads at most `maxBytes` of the body; returns null if it is larger. */
export async function readCappedBody(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** Parses and validates a raw JSON body. Returns null for anything not exactly matching the schema. */
export function parseAsk(raw: string): AskInput | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = AskSchema.safeParse(json);
  if (!result.success) return null;
  const data = result.data;
  // Drop optional fields that became empty after cleaning.
  if (data.quote === "") delete data.quote;
  if (data.history) data.history = data.history.filter((h) => h.q && h.a);
  if (data.history?.length === 0) delete data.history;
  return data;
}
