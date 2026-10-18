import { readSseData } from "../sse";
import { httpError, type JsonRequest, type Provider, type ProviderRequest } from "./types";

export type ReasoningEffort = "low" | "medium" | "high";

// gpt-oss reasoning counts toward max_completion_tokens, so leave room for it. Measured on Jo's
// prompt: ~120–180 reasoning tokens at "low"; "medium" can use several hundred.
const REASONING_HEADROOM: Record<ReasoningEffort, number> = { low: 600, medium: 1500, high: 3000 };
const URL = "https://api.groq.com/openai/v1/chat/completions";

interface GroqUsage {
  total_tokens?: number;
}

interface GroqChunk {
  choices?: { delta?: { content?: string } }[];
  usage?: GroqUsage;
  x_groq?: { usage?: GroqUsage };
}

interface GroqMessage {
  choices?: { message?: { content?: string } }[];
  usage?: GroqUsage;
}

export function groqProvider(apiKey: string, model: string, reasoningEffort: ReasoningEffort = "low"): Provider {
  return {
    name: `groq:${model}`,
    async *stream(req: ProviderRequest, signal: AbortSignal) {
      const res = await fetch(URL, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          stream: true,
          // The last chunk then carries the token count, for the private usage page.
          stream_options: { include_usage: true },
          temperature: 0.4,
          // The visible answer is capped separately in answer.ts.
          max_completion_tokens: req.maxTokens + REASONING_HEADROOM[reasoningEffort],
          // gpt-oss models reason before answering; never stream the reasoning.
          reasoning_effort: reasoningEffort,
          reasoning_format: "hidden",
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      });
      if (!res.ok || !res.body) throw await httpError(res);

      for await (const data of readSseData(res.body)) {
        if (data === "[DONE]") return;
        try {
          const chunk = JSON.parse(data) as GroqChunk;
          const usage = chunk.usage?.total_tokens ?? chunk.x_groq?.usage?.total_tokens;
          if (usage) req.onUsage?.(usage);
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // ignore keep-alives and malformed lines
        }
      }
    },
    async json(req: JsonRequest, signal: AbortSignal) {
      const res = await fetch(URL, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_completion_tokens: req.maxTokens + REASONING_HEADROOM.low,
          reasoning_effort: "low",
          reasoning_format: "hidden",
          // Strict mode: constrained decoding to the schema (gpt-oss supports it on Groq).
          response_format: { type: "json_schema", json_schema: { name: req.name, strict: true, schema: req.schema } },
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      });
      if (!res.ok) throw await httpError(res);
      const body = (await res.json()) as GroqMessage;
      if (body.usage?.total_tokens) req.onUsage?.(body.usage.total_tokens);
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("empty structured response");
      return content;
    },
  };
}
