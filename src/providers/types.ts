export interface ProviderRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface Provider {
  /** Short name for logs only. Never sent to the browser. */
  readonly name: string;
  /** Streams answer text. Must honour `signal` (abort the upstream fetch). */
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<string>;
}

/** The provider refused or blocked the content (safety filters). Not worth retrying elsewhere. */
export class ProviderBlockedError extends Error {
  constructor() {
    super("blocked");
  }
}

/** Upstream HTTP error. `status` is kept for logs; it never reaches the browser. */
export class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`upstream ${status}`);
  }
}
