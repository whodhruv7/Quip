// Quip V2 — MODEL ROUTER (hardened)
// -----------------------------------------------------------------------------
// One place that knows how to talk to LLM providers.
//
// Reliability strategy:
//   1. Provider order comes from QUIP_PRIMARY_PROVIDER (default: whichever key
//      exists — OpenRouter preferred because Groq free keys 401 often).
//   2. On transport failure, retry once (transient network), then try the
//      next provider.
//   3. TLS/certificate errors are retried through Electron's net.fetch which
//      uses the OS certificate store (fixes corporate proxies / AV inspection).
//   4. Errors carry a stable `kind` so IPC can show precise, calm messages.
//   5. Secrets are NEVER logged raw — only masked diagnostics.
// -----------------------------------------------------------------------------

import { net } from "electron";
import type {
  ModelConfig,
  ModelProvider,
  ModelRouterStatus,
} from "../../src/types";
import { maskSecret, describeError as describeErrorPure } from "./model-config";

export { maskSecret } from "./model-config";

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  signal?: AbortSignal;
}

export type ChatErrorKind = "no-key" | "auth" | "rate-limit" | "http" | "network" | "timeout";

/** Error with a stable machine-readable kind (used by IPC error mapping). */
export class ModelTransportError extends Error {
  kind: ChatErrorKind;
  constructor(kind: ChatErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

interface ProviderAdapter {
  config: ModelConfig;
  /** Returns true if this provider has a usable key. */
  isConfigured: () => boolean;
  /** Stream a chat completion. Throws ModelTransportError on failure. */
  stream: (
    systemPrompt: string,
    history: { role: "user" | "assistant"; content: string }[],
    cb: StreamCallbacks
  ) => Promise<string>;
  /** Non-streaming completion (for extraction tasks). Throws on error. */
  complete: (
    systemPrompt: string,
    history: { role: "user" | "assistant"; content: string }[],
    timeoutMs?: number
  ) => Promise<string>;
}

const REQUEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Transport — Node fetch with Electron net.fetch TLS fallback.
// Some Windows setups (AV inspection, corporate proxies) break Node's TLS.
// Electron's net.fetch uses Chromium's network stack + OS cert store.
// ---------------------------------------------------------------------------

function isTlsError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return (
    msg.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE") ||
    msg.includes("SELF_SIGNED_CERT_IN_CHAIN") ||
    msg.includes("CERT_HAS_EXPIRED") ||
    msg.includes("DEPTH_ZERO_SELF_SIGNED_CERT") ||
    msg.includes("unable to verify the first certificate") ||
    msg.includes("ERR_TLS_CERT_ALTNAME_INVALID") ||
    msg.includes("certificate")
  );
}

async function modelFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (isTlsError(error)) {
      // Electron net.fetch — uses OS trust store. Only for the TLS failure path.
      return await net.fetch(url, init);
    }
    throw error;
  }
}

function classifyStatus(provider: string, status: number): ChatErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "http";
  return "http";
}

// ---------------------------------------------------------------------------
// Shared OpenAI-compatible request builder
// ---------------------------------------------------------------------------

interface OpenAICompat {
  url: string;
  key: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

function buildBody(cfg: OpenAICompat, systemPrompt: string, history: { role: "user" | "assistant"; content: string }[], stream: boolean, maxTokens?: number) {
  return JSON.stringify({
    model: cfg.model,
    stream,
    messages: [{ role: "system", content: systemPrompt }, ...history],
    ...(stream ? {} : { temperature: 0.3, max_tokens: maxTokens ?? 1000 }),
  });
}

async function streamOpenAICompat(
  cfg: OpenAICompat,
  provider: string,
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  cb: StreamCallbacks
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (cb.signal) cb.signal.addEventListener("abort", () => controller.abort());

  try {
    let resp: Response;
    try {
      resp = await modelFetch(cfg.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          ...cfg.extraHeaders,
        },
        body: buildBody(cfg, systemPrompt, history, true),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (controller.signal.aborted && cb.signal?.aborted) throw err; // user aborted
      if ((err as Error)?.name === "AbortError") {
        throw new ModelTransportError("timeout", `${provider} request timed out`);
      }
      throw new ModelTransportError("network", `${provider} unreachable: ${(err as Error)?.message ?? err}`);
    }

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      throw new ModelTransportError(
        classifyStatus(provider, resp.status),
        `${provider}-http-${resp.status}`
      );
    }

    return await readSSE(resp.body, cb.onChunk);
  } finally {
    clearTimeout(timeout);
  }
}

async function completeOpenAICompat(
  cfg: OpenAICompat,
  provider: string,
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  timeoutMs = 30_000,
  maxTokens = 1000
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let resp: Response;
    try {
      resp = await modelFetch(cfg.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          ...cfg.extraHeaders,
        },
        body: buildBody(cfg, systemPrompt, history, false, maxTokens),
        signal: controller.signal,
      });
    } catch (err: any) {
      if ((err as Error)?.name === "AbortError") {
        throw new ModelTransportError("timeout", `${provider} request timed out`);
      }
      throw new ModelTransportError("network", `${provider} unreachable: ${(err as Error)?.message ?? err}`);
    }

    if (!resp.ok) {
      throw new ModelTransportError(classifyStatus(provider, resp.status), `${provider}-http-${resp.status}`);
    }

    const data: any = await resp.json();
    return data?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// SSE reader — shared by both OpenAI-compatible providers.
// ---------------------------------------------------------------------------

async function readSSE(
  body: ReadableStream<Uint8Array>,
  onChunk: (delta: string) => void
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta: string = json?.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          onChunk(delta);
        }
      } catch {
        /* partial JSON — ignore */
      }
    }
  }
  return full;
}

// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------

function makeGroq(): ProviderAdapter {
  const config: ModelConfig = {
    provider: "groq",
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    label: `Groq · ${process.env.GROQ_MODEL || "Llama 3.3 70B"}`,
    available: false,
  };
  return {
    config,
    isConfigured: () => {
      const k = process.env.GROQ_API_KEY;
      return !!k && k !== "your-groq-key-here" && k.length > 8;
    },
    async stream(systemPrompt, history, cb) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-groq-key");
      return streamOpenAICompat(
        { url: "https://api.groq.com/openai/v1/chat/completions", key, model: config.model },
        "groq", systemPrompt, history, cb
      );
    },
    async complete(systemPrompt, history, timeoutMs = 30_000) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-groq-key");
      return completeOpenAICompat(
        { url: "https://api.groq.com/openai/v1/chat/completions", key, model: config.model },
        "groq", systemPrompt, history, timeoutMs
      );
    },
  };
}

function makeOpenRouter(): ProviderAdapter {
  const config: ModelConfig = {
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL || "minimax/minimax-m3:free",
    label: `OpenRouter · ${(process.env.OPENROUTER_MODEL || "minimax/minimax-m3:free").split("/").pop()}`,
    available: false,
  };
  return {
    config,
    isConfigured: () => {
      const k = process.env.OPENROUTER_API_KEY;
      return !!k && k !== "sk-or-v1-your-key-here" && k.length > 8;
    },
    async stream(systemPrompt, history, cb) {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-openrouter-key");
      return streamOpenAICompat(
        {
          url: "https://openrouter.ai/api/v1/chat/completions",
          key,
          model: config.model,
          extraHeaders: { "HTTP-Referer": "https://quip.app", "X-Title": "Quip" },
        },
        "openrouter", systemPrompt, history, cb
      );
    },
    async complete(systemPrompt, history, timeoutMs = 30_000) {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-openrouter-key");
      return completeOpenAICompat(
        {
          url: "https://openrouter.ai/api/v1/chat/completions",
          key,
          model: config.model,
          extraHeaders: { "HTTP-Referer": "https://quip.app", "X-Title": "Quip" },
        },
        "openrouter", systemPrompt, history, timeoutMs
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class ModelRouter {
  private primary: ProviderAdapter;
  private fallback: ProviderAdapter | null;
  private activeProvider: ModelProvider = "groq";

  constructor() {
    const groq = makeGroq();
    const openrouter = makeOpenRouter();
    const primaryPref = (process.env.QUIP_PRIMARY_PROVIDER || "").toLowerCase();

    // Provider order: explicit env override → whichever is configured → OpenRouter first.
    if (primaryPref === "groq") {
      this.primary = groq;
      this.fallback = openrouter;
    } else if (primaryPref === "openrouter") {
      this.primary = openrouter;
      this.fallback = groq;
    } else if (openrouter.isConfigured()) {
      this.primary = openrouter;
      this.fallback = groq;
    } else {
      this.primary = groq;
      this.fallback = openrouter;
    }
    this.activeProvider = this.primary.isConfigured()
      ? this.primary.config.provider
      : this.fallback?.isConfigured()
        ? this.fallback.config.provider
        : this.primary.config.provider;
  }

  /** Ordered, configured providers (primary first). */
  private chain(): ProviderAdapter[] {
    const list: ProviderAdapter[] = [];
    if (this.primary.isConfigured()) list.push(this.primary);
    if (this.fallback && this.fallback.isConfigured() && this.fallback !== this.primary) {
      list.push(this.fallback);
    }
    return list;
  }

  /** Stream a chat completion, trying each configured provider once (with one transient retry). */
  async stream(
    systemPrompt: string,
    history: { role: "user" | "assistant"; content: string }[],
    cb: StreamCallbacks
  ): Promise<{ full: string; provider: ModelProvider }> {
    const providers = this.chain();
    let lastErr: unknown = null;

    for (const p of providers) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const full = await p.stream(systemPrompt, history, cb);
          this.activeProvider = p.config.provider;
          return { full, provider: p.config.provider };
        } catch (err: any) {
          lastErr = err;
          if (cb.signal?.aborted) throw err;
          const kind: ChatErrorKind = err instanceof ModelTransportError ? err.kind : "network";
          // Retry only transient network failures; auth/rate-limit/http move on.
          if (kind === "network" && attempt === 0) continue;
          break;
        }
      }
      if (cb.signal?.aborted) break;
    }

    throw lastErr ?? new ModelTransportError("no-key", "No AI provider configured");
  }

  status(): ModelRouterStatus {
    const primary = { ...this.primary.config, available: this.primary.isConfigured() };
    const fallback = this.fallback
      ? { ...this.fallback.config, available: this.fallback.isConfigured() }
      : null;
    const active =
      this.activeProvider === primary.provider
        ? primary
        : fallback && this.activeProvider === fallback.provider
          ? fallback
          : primary;
    return {
      primary,
      fallback,
      active,
      healthy: primary.available || !!fallback?.available,
    };
  }

  /** Non-streaming completion with provider chain. Used by extraction/planning tasks. */
  async complete(
    systemPrompt: string,
    history: { role: "user" | "assistant"; content: string }[],
    timeoutMs?: number
  ): Promise<string> {
    const providers = this.chain();
    let lastErr: unknown = null;
    for (const p of providers) {
      try {
        const result = await p.complete(systemPrompt, history, timeoutMs);
        this.activeProvider = p.config.provider;
        return result;
      } catch (err: any) {
        lastErr = err;
        const kind: ChatErrorKind = err instanceof ModelTransportError ? err.kind : "network";
        if (kind === "auth" || kind === "no-key") continue; // try next provider
        // rate-limit / network / timeout: brief single retry on same provider
        try {
          const result = await p.complete(systemPrompt, history, timeoutMs);
          this.activeProvider = p.config.provider;
          return result;
        } catch (err2) {
          lastErr = err2;
        }
      }
    }
    throw lastErr ?? new ModelTransportError("no-key", "No AI provider configured");
  }

  /** Masked diagnostics — safe to log/show. Never includes raw keys. */
  diagnostics(): string {
    const s = this.status();
    return [
      `provider=${s.active.provider}`,
      `model=${s.active.model}`,
      `groqKey=${maskSecret(process.env.GROQ_API_KEY)}`,
      `openrouterKey=${maskSecret(process.env.OPENROUTER_API_KEY)}`,
    ].join(" ");
  }
}

/** Map a model error to a calm, actionable user message (no raw internals). */
export const describeError = describeErrorPure;

export const modelRouter = new ModelRouter();
