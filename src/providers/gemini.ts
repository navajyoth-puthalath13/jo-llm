import { readSseData } from "../sse";
import { ProviderBlockedError, httpError, type Provider, type ProviderRequest } from "./types";

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
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
  }[];
}

export function geminiProvider(apiKey: string, model: string): Provider {
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
          generationConfig: { maxOutputTokens: req.maxTokens, temperature: 0.4 },
          safetySettings: SAFETY_SETTINGS,
        }),
      });
      if (!res.ok || !res.body) throw httpError(res);

      for await (const data of readSseData(res.body)) {
        let chunk: GeminiChunk;
        try {
          chunk = JSON.parse(data) as GeminiChunk;
        } catch {
          continue;
        }
        if (chunk.promptFeedback?.blockReason) throw new ProviderBlockedError();
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
  };
}
