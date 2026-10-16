import { readSseData } from "../sse";
import { ProviderHttpError, type Provider, type ProviderRequest } from "./types";

const URL = "https://api.groq.com/openai/v1/chat/completions";

interface GroqChunk {
  choices?: { delta?: { content?: string } }[];
}

export function groqProvider(apiKey: string, model: string): Provider {
  return {
    name: "groq",
    async *stream(req: ProviderRequest, signal: AbortSignal) {
      const res = await fetch(URL, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: 0.4,
          max_completion_tokens: req.maxTokens,
          // gpt-oss models reason before answering: keep it brief and never stream it.
          reasoning_effort: "low",
          reasoning_format: "hidden",
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      });
      if (!res.ok || !res.body) throw new ProviderHttpError(res.status);

      for await (const data of readSseData(res.body)) {
        if (data === "[DONE]") return;
        try {
          const text = (JSON.parse(data) as GroqChunk).choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // ignore keep-alives and malformed lines
        }
      }
    },
  };
}
