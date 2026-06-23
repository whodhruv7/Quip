// Quip V2 — MODEL ROUTER
// -----------------------------------------------------------------------------
// One place that knows how to talk to LLM providers. Replaces the inline
// OpenRouter + Groq code that used to live in main.ts.
//
// Strategy:
//   1. Try the PRIMARY provider.
//   2. On any failure (auth, rate limit, network), try the FALLBACK.
//   3. Never expose raw API errors to the user — return graceful messages.
//   4. Report which model is active so the UI can show it.
//
// Providers are pluggable. Adding a local model later = adding one entry.
// -----------------------------------------------------------------------------

import type {
  ModelConfig,
  ModelProvider,
  ModelRouterStatus,
} from "../../src/types";

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  signal?: AbortSignal;
}

interface ProviderAdapter {
  config: ModelConfig;
  /** Returns true if this provider has a usable key. */
  isConfigured: () => boolean;
  /** Stream a chat completion. Throws on error. */
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
// Groq adapter (primary — fast + free tier)
// ---------------------------------------------------------------------------

function makeGroq(): ProviderAdapter {
  const config: ModelConfig = {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    label: "Groq · Llama 3.3 70B",
    available: false,
  };
  return {
    config,
    isConfigured: () => !!process.env.GROQ_API_KEY,
    async stream(systemPrompt, history, cb) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new Error("no-groq-key");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      if (cb.signal) cb.signal.addEventListener("abort", () => controller.abort());

      try {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            stream: true,
            messages: [
              { role: "system", content: systemPrompt },
              ...history,
            ],
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          const text = await resp.text().catch(() => "");
          throw new Error(`groq-http-${resp.status}:${text.slice(0, 120)}`);
        }

        return await readSSE(resp.body, cb.onChunk);
      } finally {
        clearTimeout(timeout);
      }
    },
    async complete(systemPrompt, history, timeoutMs = 30_000) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new Error("no-groq-key");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            messages: [
              { role: "system", content: systemPrompt },
              ...history,
            ],
            temperature: 0.3,
            max_tokens: 1000,
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new Error(`groq-http-${resp.status}:${text.slice(0, 120)}`);
        }

        const data: any = await resp.json();
        return data?.choices?.[0]?.message?.content ?? "";
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// OpenRouter adapter (fallback)
// ---------------------------------------------------------------------------

function makeOpenRouter(): ProviderAdapter {
  const config: ModelConfig = {
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL || "google/gemma-3-27b-it:free",
    label: "OpenRouter · Gemma 3 27B",
    available: false,
  };
  return {
    config,
    isConfigured: () =>
      !!process.env.OPENROUTER_API_KEY &&
      process.env.OPENROUTER_API_KEY !== "sk-or-v1-your-key-here",
    async stream(systemPrompt, history, cb) {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("no-openrouter-key");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      if (cb.signal) cb.signal.addEventListener("abort", () => controller.abort());

      try {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://quip.app",
            "X-Title": "Quip",
          },
          body: JSON.stringify({
            model: config.model,
            stream: true,
            messages: [
              { role: "system", content: systemPrompt },
              ...history,
            ],
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          const text = await resp.text().catch(() => "");
          throw new Error(`openrouter-http-${resp.status}:${text.slice(0, 120)}`);
        }

        return await readSSE(resp.body, cb.onChunk);
      } finally {
        clearTimeout(timeout);
      }
    },
    async complete(systemPrompt, history, timeoutMs = 30_000) {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("no-openrouter-key");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://quip.app",
            "X-Title": "Quip",
          },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            messages: [
              { role: "system", content: systemPrompt },
              ...history,
            ],
            temperature: 0.3,
            max_tokens: 1000,
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new Error(`openrouter-http-${resp.status}:${text.slice(0, 120)}`);
        }

        const data: any = await resp.json();
        return data?.choices?.[0]?.message?.content ?? "";
      } finally {
        clearTimeout(timeout);
      }
    },
  };
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
// Router
// ---------------------------------------------------------------------------

class ModelRouter {
  private primary: ProviderAdapter;
  private fallback: ProviderAdapter | null;
  private activeProvider: ModelProvider = "groq";

  constructor() {
    this.primary = makeGroq();
    this.fallback = makeOpenRouter();
    this.activeProvider = this.primary.isConfigured()
      ? "groq"
      : this.fallback?.isConfigured()
        ? "openrouter"
        : "local";
  }

  /** Stream a chat completion, trying primary then fallback. */
  async stream(
    systemPrompt: string,
    history: { role: "user" | "assistant"; content: string }[],
    cb: StreamCallbacks
  ): Promise<{ full: string; provider: ModelProvider }> {
    const providers: ProviderAdapter[] = [this.primary];
    if (this.fallback && this.fallback.isConfigured()) {
      providers.push(this.fallback);
    }

    let lastErr: unknown = null;
    for (const p of providers) {
      if (!p.isConfigured()) continue;
      try {
        const full = await p.stream(systemPrompt, history, cb);
        this.activeProvider = p.config.provider;
        return { full, provider: p.config.provider };
      } catch (err: any) {
        lastErr = err;
        // If user aborted, don't try fallback.
        if (cb.signal?.aborted) break;
        // otherwise, fall through to next provider.
      }
    }

    const full = buildLocalFallback(history, lastErr);
    this.activeProvider = "local";
    return { full, provider: "local" };
  }

  status(): ModelRouterStatus {
    const primary = { ...this.primary.config, available: this.primary.isConfigured() };
    const fallback = this.fallback
      ? { ...this.fallback.config, available: this.fallback.isConfigured() }
      : null;
    const localActive: ModelConfig = {
      provider: "local",
      model: "local-fallback",
      label: "Local fallback",
      available: true,
    };
    const active =
      this.activeProvider === "openrouter" && fallback
        ? fallback
        : this.activeProvider === "local"
          ? localActive
          : primary;
    return {
      primary,
      fallback,
      active,
      healthy: primary.available || !!fallback?.available || this.activeProvider === "local",
    };
  }

  /** Non-streaming completion with primary→fallback. Used by extraction tasks. */
  async complete(
    systemPrompt: string,
    history: { role: "user" | "assistant"; content: string }[],
    timeoutMs?: number
  ): Promise<string> {
    const providers: ProviderAdapter[] = [this.primary];
    if (this.fallback && this.fallback.isConfigured()) {
      providers.push(this.fallback);
    }

    let lastErr: unknown = null;
    for (const p of providers) {
      if (!p.isConfigured()) continue;
      try {
        const result = await p.complete(systemPrompt, history, timeoutMs);
        this.activeProvider = p.config.provider;
        return result;
      } catch (err: any) {
        lastErr = err;
        // fall through to next provider
      }
    }
    this.activeProvider = "local";
    return "";
  }
}

function buildLocalFallback(
  history: { role: "user" | "assistant"; content: string }[],
  err: unknown
): string {
  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content?.trim();
  const reason = describeError(err);
  if (!lastUser) {
    return "I am running in local fallback mode right now, so I cannot reach the AI provider. You can still use local actions like opening apps, searching, and moving the window.";
  }
  return [
    "I could not reach the AI provider just now, so I am using local fallback mode.",
    "I can still handle local actions like opening apps, searching, and window control.",
    `You asked: ${lastUser}`,
    `Status: ${reason}`,
  ].join(" ");
}

function describeError(err: unknown): string {
  if (!err) return "Chat is unavailable right now.";
  const msg = (err as Error)?.message ?? String(err);
  if (msg.includes("no-groq-key") || msg.includes("no-openrouter-key")) {
    return "No AI provider is configured. Add GROQ_API_KEY to your .env file.";
  }
  if (msg.includes("groq-http-401") || msg.includes("openrouter-http-401")) {
    return "AI provider rejected the API key. Check your .env file.";
  }
  if (msg.includes("-429")) {
    return "Rate limited by the AI provider. Try again in a moment.";
  }
  if ((err as any)?.name === "AbortError") {
    return "Request timed out. Try again.";
  }
  if (msg.startsWith("groq-http-") || msg.startsWith("openrouter-http-")) {
    return "The AI provider had a problem. Try again.";
  }
  return `Network error: ${msg}`;
}

export const modelRouter = new ModelRouter();
