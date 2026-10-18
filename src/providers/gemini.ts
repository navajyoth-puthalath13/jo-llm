import { readSseData } from "../sse";
import { ProviderBlockedError, httpError, type JsonRequest, type Provider, type ProviderRequest } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Google's default threshold. BLOCK_LOW_AND_ABOVE was tested and misfires on harmless output
// (it blocked a bare "[[OFFTOPIC]]"), which turned real answers into declines.
const SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_MEDIUM_AND_ABOVE" }));

interface GeminiChunk {
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { totalTokenCount?: number };
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
  }[];
}

/** Gemini's responseSchema is an OpenAPI subset: no additionalProperties. */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) if (k !== "additionalProperties") out[k] = toGeminiSchema(v);
  return out;
}

export interface GeminiOptions {
  /** Gemini 3 "thinking" level for answers. Thinking tokens count toward maxOutputTokens, so the
   *  request gets extra room; the visible answer is still capped in answer.ts. */
  thinkingLevel?: "low" | "medium" | "high";
}

const THINKING_HEADROOM = 1024;

export function geminiProvider(apiKey: string, model: string, opts: GeminiOptions = {}): Provider {
  return {
    name: `gemini:${model}`,
    async *stream(req: ProviderRequest, signal: AbortSignal) {
      const res = await fetch(`${BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: opts.thinkingLevel
            ? { maxOutputTokens: req.maxTokens + THINKING_HEADROOM, temperature: 0.3, thinkingConfig: { thinkingLevel: opts.thinkingLevel } }
            : { maxOutputTokens: req.maxTokens, temperature: 0.4 },
          safetySettings: SAFETY_SETTINGS,
        }),
      });
      if (!res.ok || !res.body) throw await httpError(res);

      for await (const data of readSseData(res.body)) {
        let chunk: GeminiChunk;
        try {
          chunk = JSON.parse(data) as GeminiChunk;
        } catch {
          continue;
        }
        if (chunk.promptFeedback?.blockReason) throw new ProviderBlockedError();
        if (chunk.usageMetadata?.totalTokenCount) req.onUsage?.(chunk.usageMetadata.totalTokenCount);
        const cand = chunk.candidates?.[0];
        for (const part of cand?.content?.parts ?? []) {
          if (part.text && !part.thought) yield part.text;
        }
        const reason = cand?.finishReason;
        if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || reason === "BLOCKLIST" || reason === "SPII") {
          throw new ProviderBlockedError();
        }
      }
    },
    async json(req: JsonRequest, signal: AbortSignal) {
      const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: {
            maxOutputTokens: req.maxTokens,
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(req.schema),
          },
          safetySettings: SAFETY_SETTINGS,
        }),
      });
      if (!res.ok) throw await httpError(res);
      const body = (await res.json()) as GeminiChunk;
      if (body.promptFeedback?.blockReason) throw new ProviderBlockedError();
      if (body.usageMetadata?.totalTokenCount) req.onUsage?.(body.usageMetadata.totalTokenCount);
      const text = (body.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join("");
      if (!text) throw new Error("empty structured response");
      return text;
    },
  };
}
