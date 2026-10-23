// Server-sent events: writing our own stream to the browser, and reading provider streams.

import type { ResolvedAction } from "./actions";

export type ErrorCode = "offline" | "rate_limited" | "busy" | "invalid" | "offtopic";

export type JoEvent =
  | { event: "token"; data: { t: string } }
  | { event: "actions"; data: { actions: ResolvedAction[] } }
  | { event: "done"; data: { cached: boolean; awaitingReply?: true } }
  | { event: "error"; data: { code: ErrorCode } };

const encoder = new TextEncoder();

export function encodeEvent(e: JoEvent): Uint8Array {
  return encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
}

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
};

/** A response containing a single error event. Used before any streaming starts. */
export function errorResponse(code: ErrorCode, status: number, headers: Record<string, string> = {}): Response {
  return new Response(encodeEvent({ event: "error", data: { code } }), {
    status,
    headers: { ...SSE_HEADERS, ...headers },
  });
}

export interface EventWriter {
  token(t: string): Promise<void>;
  /** Sent after the last token and before done, only with at least one action. Never with an error. */
  actions(actions: ResolvedAction[]): Promise<void>;
  /** `awaitingReply`: Jo's answer ends with a question to the visitor, so keep the reply box open. */
  done(cached: boolean, awaitingReply?: boolean): Promise<void>;
  error(code: ErrorCode): Promise<void>;
  close(): Promise<void>;
}

/** Creates a streaming SSE body. Writes reject once the client has gone away. */
export function createEventStream(): { readable: ReadableStream<Uint8Array>; writer: EventWriter } {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const w = writable.getWriter();
  let closed = false;
  const send = async (e: JoEvent) => {
    if (closed) throw new Error("stream closed");
    await w.write(encodeEvent(e));
  };
  return {
    readable,
    writer: {
      token: (t) => send({ event: "token", data: { t } }),
      actions: (actions) => send({ event: "actions", data: { actions } }),
      done: (cached, awaitingReply) => send({ event: "done", data: awaitingReply ? { cached, awaitingReply: true } : { cached } }),
      error: (code) => send({ event: "error", data: { code } }),
      close: async () => {
        if (closed) return;
        closed = true;
        await w.close().catch(() => {});
      },
    },
  };
}

/** Yields the `data:` payload of each event in an SSE byte stream (multi-line data joined with \n). */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (line === "") {
          if (data.length) yield data.join("\n");
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
    }
    const tail = buffer.replace(/\r$/, "");
    if (tail.startsWith("data:")) data.push(tail.slice(5).replace(/^ /, ""));
    if (data.length) yield data.join("\n");
  } finally {
    reader.releaseLock();
  }
}
