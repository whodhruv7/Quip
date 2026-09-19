// Quip V3 — MODEL ROUTER (hardened, 4 providers)
// -----------------------------------------------------------------------------
// One place that knows how to talk to LLM providers.
//
// Reliability strategy:
//   1. FOUR providers — Groq, Cerebras, NVIDIA, OpenRouter — all
//      OpenAI-compatible. The chain is built from every provider that is
//      enabled AND has a key. Priority: QUIP_PRIMARY_PROVIDER env (set from
//      Settings) → GROQ FIRST when no preference (user preference: the Groq
//      key is THE key) → Cerebras → NVIDIA → OpenRouter.
//   2. Per-provider kill switches from Settings: QUIP_GROQ_ENABLED=0 etc.
//      removes a provider from the chain entirely — it is never dialed.
//   3. On transport failure, retry once (transient network), then move to
//      the NEXT provider automatically. The user sees which provider answered.
//   4. When EVERY provider fails, the thrown error carries a failure TRAIL:
//      one honest line per provider explaining why it was skipped (no key,
//      key rejected, rate limit, timeout…). No more mystery "can't connect".
//   5. TLS/certificate errors are retried through Electron's net.fetch which
//      uses the OS certificate store (fixes corporate proxies / AV inspection).
//   6. Errors carry a stable `kind` so IPC can show precise, calm messages.
//   7. reload() re-reads the environment after Settings changes — the
//      singleton never needs an app restart to switch providers.
//   8. completeVision() sends a screenshot to a vision-capable model on the
//      SAME configured keys (Groq llama-4 first, then Cerebras/NVIDIA llama-4,
//      then OpenRouter) — the screen-understanding loop runs on the user's
//      primary brain, not a separate service.
//   9. Secrets are NEVER logged raw — only masked diagnostics.
// -----------------------------------------------------------------------------

import { net } from "electron";
import type {
  ModelConfig,
  ModelProvider,
  ModelRouterStatus,
} from "../../src/types";
import { maskSecret, describeError as describeErrorPure } from "./model-config";
import {
  PROVIDER_ORDER,
  PROVIDER_LABEL,
  PROVIDER_ENABLED_VAR,
  DEFAULT_MODELS,
  FALLBACK_MODELS,
  isProviderEnabled,
  type ProviderId,
} from "./env-store";
import { providerErrorSnippet } from "./provider-probe";
import { ollamaBaseUrl } from "./provider-probe";
import { CircuitBreaker, parseRetryAfterMs } from "./circuit-breaker";
import { connectionJournal } from "./connection-journal";

export { maskSecret } from "./model-config";

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  signal?: AbortSignal;
  /** Announced at the START of each provider attempt (confirmed=false,
   *  "trying X…") and again once its headers arrived (confirmed=true, the
   *  chip the user sees becomes "X"). Powers the live provider chip. */
  onProvider?: (provider: string, confirmed: boolean) => void;
}

export type ChatErrorKind = "no-key" | "auth" | "rate-limit" | "http" | "network" | "timeout";

/** Error with a stable machine-readable kind (used by IPC error mapping). */
export class ModelTransportError extends Error {
  kind: ChatErrorKind;
  /** One honest line per provider that was tried/skipped, in order. */
  attempts: string[];
  /** True when the provider rejected the MODEL ID (decommissioned/renamed) —
   *  the router retries the next candidate model on the same provider. */
  modelRejected?: boolean;
  /** Milliseconds the provider asked us to wait (HTTP 429 Retry-After).
   *  Feeds the circuit breaker so a rate-limited provider rests exactly as
   *  long as it asked — not a blind fixed retry that burns more 429s. */
  retryAfterMs?: number | null;
  constructor(
    kind: ChatErrorKind,
    message: string,
    attempts: string[] = [],
    modelRejected = false,
    retryAfterMs: number | null = null
  ) {
    super(message);
    this.kind = kind;
    this.attempts = attempts;
    this.modelRejected = modelRejected;
    this.retryAfterMs = retryAfterMs;
  }
}

interface ProviderAdapter {
  config: ModelConfig;
  /** Returns true if this provider has a usable key. */
  isConfigured: () => boolean;
  /** Settings kill-switch: a disabled provider is never dialed. */
  isEnabled: () => boolean;
  /** Model used for image understanding on this provider (or null if none). */
  visionModel: () => string | null;
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
  /** Vision completion: one user message with an image + text. Throws on error. */
  completeVision: (
    prompt: string,
    imageBase64: string,
    mimeType: string,
    timeoutMs?: number
  ) => Promise<string>;
  /** Tool-calling completion for the agent loop. Throws on error. */
  completeWithTools: (
    systemPrompt: string,
    history: ChatPart[],
    tools: ToolSchema[],
    timeoutMs?: number,
    maxTokens?: number
  ) => Promise<{ content: string; toolCalls: ToolCall[] }>;
}

/**
 * One message in a model conversation (OpenAI-compatible shapes):
 * - plain user/assistant text
 * - assistant asking for tools (tool_calls)
 * - tool result (role "tool" + tool_call_id)
 * - user message with an image (vision)
 */
export interface ChatPart {
  role: "user" | "assistant" | "tool";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

const REQUEST_TIMEOUT_MS = 60_000;
/** Connect + headers deadline. A provider that cannot even answer within
 *  12s will rarely produce a snappy chat — fail over FAST instead of letting
 *  one dead endpoint hold the reply hostage for a full minute. */
const CONNECT_TIMEOUT_MS = 12_000;
/** SSE stall watchdog — no bytes for this long mid-stream = dead proxy/broken
 *  connection; abort and fail over instead of waiting forever. */
const SSE_STALL_TIMEOUT_MS = 25_000;

// ---------------------------------------------------------------------------
// Transport — Electron net.fetch FIRST, Node fetch as automatic fallback.
// Electron's net module runs on Chromium's network stack: system proxy,
// OS certificate store, IPv6 happy-eyeballs. Node's undici fetch ignores the
// Windows system proxy — on VPN/Clash/corporate setups every request dies
// with a network error while the browser works fine. That mismatch was one
// of the reasons "providers never connect" on the user's laptop. Trying BOTH
// transports (and TLS-mismatch retry) covers proxy, AV-inspection and cert
// pinning failures.
// QUIP_TRANSPORT=net|node pins ONE stack — the escape hatch for machines
// where a specific stack is broken (VSCode hit the same class of bug with
// Electron fetch behind proxies). Set from Settings → AI Brain.
// ---------------------------------------------------------------------------

function transportMode(): "auto" | "net" | "node" {
  const t = (process.env.QUIP_TRANSPORT || "auto").toLowerCase();
  return t === "net" || t === "node" ? t : "auto";
}

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

function hasElectronNet(): boolean {
  return !!net && typeof (net as any).fetch === "function";
}

async function modelFetch(url: string, init: RequestInit): Promise<Response> {
  const mode = transportMode();
  const useNet = mode === "node" ? false : mode === "net" ? true : hasElectronNet();
  const viaNet = () => (net as any).fetch(url, init) as Promise<Response>;
  const viaNode = () => fetch(url, init);
  const first = useNet ? viaNet : viaNode;
  const second = useNet ? viaNode : viaNet;
  if (mode !== "auto") {
    // Pinned transport: ONE stack, no silent swapping (the user chose it
    // precisely because the other stack misbehaves on their machine).
    return await first();
  }
  try {
    return await first();
  } catch (error) {
    if (isTlsError(error)) {
      // The two stacks fail differently on TLS interception — swap stacks.
      return await second();
    }
    // Proxy/VPN/DNS setups differ per stack too. One shot with the other
    // stack before giving up (the signal still governs the total timeout).
    try {
      return await second();
    } catch {
      throw error; // surface the FIRST (primary transport) error
    }
  }
}

function classifyStatus(status: number): ChatErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  return "http";
}

function keyMissingNote(varName: string): string {
  return `${varName} not set — add the key in Settings → AI Brain`;
}

function disabledNote(label: string): string {
  return `${label} is switched off in Settings → AI Brain`;
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

function buildBody(cfg: OpenAICompat, systemPrompt: string, history: ChatPart[], stream: boolean, maxTokens?: number, tools?: unknown[]) {
  return JSON.stringify({
    model: cfg.model,
    stream,
    messages: [{ role: "system", content: systemPrompt }, ...history],
    ...(stream ? {} : { temperature: 0.3, max_tokens: maxTokens ?? 1000 }),
    ...(tools && tools.length ? { tools, tool_choice: "auto", temperature: 0.1, max_tokens: maxTokens ?? 2048 } : {}),
  });
}

/** Does this provider response mean the MODEL ID itself is dead?
 *  (decommissioned, renamed, not-found — the exact failure class that killed
 *  the old Groq/OpenRouter defaults). Checked against status + provider's
 *  own error words so we never mistake a bad prompt for a dead model. */
function isModelRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false;
  const snippet = providerErrorSnippet(body).toLowerCase();
  if (!snippet) return false;
  return /\bmodel\b/.test(snippet) &&
    /(not found|not exist|does not exist|no longer|decommission|deprecat|invalid|unknown|unsupported|retired|not available|not supported)/.test(snippet);
}

async function streamOpenAICompat(
  cfg: OpenAICompat,
  provider: string,
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  cb: StreamCallbacks
): Promise<string> {
  const controller = new AbortController();
  const overall = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    CONNECT_TIMEOUT_MS
  );
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

    // Headers arrived — the connect deadline is served; switch to the
    // overall + stall watchdogs.
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    cb.onProvider?.(provider, true); // confirmed — this provider is answering

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      const snippet = providerErrorSnippet(text);
      const retryAfter = parseRetryAfterMs(
        (resp.headers as any)?.get?.("retry-after") ?? null
      );
      throw new ModelTransportError(
        classifyStatus(resp.status),
        `${provider}-http-${resp.status}${snippet ? ` — ${snippet}` : ""}`,
        [],
        isModelRejection(resp.status, text),
        retryAfter
      );
    }

    return await readSSE(resp.body, cb.onChunk, controller);
  } finally {
    clearTimeout(overall);
    if (connectTimer) clearTimeout(connectTimer);
  }
}

async function completeOpenAICompat(
  cfg: OpenAICompat,
  provider: string,
  systemPrompt: string,
  history: ChatPart[],
  timeoutMs = 30_000,
  maxTokens = 1000,
  tools?: unknown[]
): Promise<{ content: string; toolCalls: ToolCall[] }> {
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
        body: buildBody(cfg, systemPrompt, history, false, maxTokens, tools),
        signal: controller.signal,
      });
    } catch (err: any) {
      if ((err as Error)?.name === "AbortError") {
        throw new ModelTransportError("timeout", `${provider} request timed out`);
      }
      throw new ModelTransportError("network", `${provider} unreachable: ${(err as Error)?.message ?? err}`);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const snippet = providerErrorSnippet(text);
      const retryAfter = parseRetryAfterMs(
        (resp.headers as any)?.get?.("retry-after") ?? null
      );
      throw new ModelTransportError(
        classifyStatus(resp.status),
        `${provider}-http-${resp.status}${snippet ? ` — ${snippet}` : ""}`,
        [],
        isModelRejection(resp.status, text),
        retryAfter
      );
    }

    const data: any = await resp.json();
    const message = data?.choices?.[0]?.message ?? {};
    const content: string = message.content ?? "";
    const toolCalls: ToolCall[] = Array.isArray(message.tool_calls)
      ? message.tool_calls
          .filter((tc: any) => tc?.function?.name)
          .map((tc: any, i: number) =>
            parseToolCall({
              id: typeof tc.id === "string" && tc.id ? tc.id : `call_${i}`,
              name: String(tc.function.name),
              arguments: typeof tc.function.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments ?? {}),
            })
          )
      : [];
    return { content, toolCalls };
  } finally {
    clearTimeout(timeout);
  }
}

/** One tool the model may call (OpenAI tools array shape). */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** A tool call the model asked for (parsed from the OpenAI-compatible reply). */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string of arguments (as sent by the model). */
  arguments: string;
  /** Parsed arguments object — empty when the JSON is malformed. */
  parsed: Record<string, any>;
}

export function parseToolCall(raw: { id: string; name: string; arguments: string }): ToolCall {
  let parsed: Record<string, any> = {};
  try {
    const p = JSON.parse(raw.arguments || "{}");
    if (p && typeof p === "object") parsed = p;
  } catch {
    /* malformed — parsed stays empty, the loop reports it honestly */
  }
  return { ...raw, parsed };
}

// ---------------------------------------------------------------------------
// Model-id fallback — providers retire model ids (Groq retired
// llama-3.3-70b-versatile for free tiers on 2026-08-16; the old OpenRouter
// default never existed). When the provider rejects the CONFIGURED id, retry
// the same provider with verified-live spare ids before failing over.
// ---------------------------------------------------------------------------

async function withModelFallback<T>(
  provider: ProviderId,
  configured: string,
  cfgFor: (model: string) => OpenAICompat,
  run: (cfg: OpenAICompat) => Promise<T>
): Promise<T> {
  const spares = FALLBACK_MODELS[provider] ?? [];
  const candidates = [configured, ...spares.filter((m) => m !== configured)];
  let lastErr: unknown = null;
  for (const model of candidates) {
    try {
      return await run(cfgFor(model));
    } catch (err: any) {
      lastErr = err;
      if (err instanceof ModelTransportError && err.modelRejected) continue; // dead id → next spare
      throw err; // auth / rate-limit / network / timeout / prompt — the router fails over
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// SSE reader — shared by all OpenAI-compatible providers.
// ---------------------------------------------------------------------------

async function readSSE(
  body: ReadableStream<Uint8Array>,
  onChunk: (delta: string) => void,
  controller?: AbortController
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  // Stall watchdog: no bytes at all for SSE_STALL_TIMEOUT_MS = the connection
  // is silently dead (proxies love to do this). Abort → the router fails over.
  let stallTimer: ReturnType<typeof setTimeout> | null = controller
    ? setTimeout(() => controller.abort(), SSE_STALL_TIMEOUT_MS)
    : null;
  const bump = () => {
    if (!controller) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), SSE_STALL_TIMEOUT_MS);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bump();
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
          // A 200 stream can still carry an error frame (quota burst, dead
          // model flagged mid-stream). Swallowing it used to produce a silent
          // empty bubble — surface it so the router fails over honestly.
          if (json && typeof json === "object" && json.error) {
            const msg = String(json.error?.message ?? JSON.stringify(json.error)).slice(0, 160);
            throw new ModelTransportError(
              "http",
              `${msg}`,
              [],
              /\bmodel\b/i.test(msg) && /(not found|not exist|decommission|deprecat|invalid|unknown|unsupported|retired)/i.test(msg)
            );
          }
          const delta: string = json?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            onChunk(delta);
          }
        } catch (e: any) {
          if (e instanceof ModelTransportError) throw e; // error frame — propagate
          /* partial JSON — ignore */
        }
      }
    }
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
  return full;
}

// ---------------------------------------------------------------------------
// Provider adapters — one factory per provider, all OpenAI-compatible.
// ---------------------------------------------------------------------------

const VISION_SYSTEM_PROMPT =
  "You are Quip's screen-reading eye. Answer with the exact data requested — coordinates as bare JSON when asked.";

/** Guard against placeholder values that used to ship in .env templates. */
function realKey(value: string | undefined, placeholder: string): boolean {
  return !!value && value !== placeholder && value.length > 8;
}

function makeGroq(): ProviderAdapter {
  const config: ModelConfig = {
    provider: "groq",
    // DEFAULT_MODELS.groq — Groq decommissioned the old literal default
    // (llama-3.3-70b-versatile) for free tiers on 2026-08-16.
    model: process.env.GROQ_MODEL || DEFAULT_MODELS.groq,
    label: `Groq · ${(process.env.GROQ_MODEL || DEFAULT_MODELS.groq).split("/").pop()}`,
    available: false,
  };
  const chat = (model?: string) => ({
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: process.env.GROQ_API_KEY ?? "",
    model: model || config.model,
  });
  return {
    config,
    isConfigured: () => realKey(process.env.GROQ_API_KEY, "your-groq-key-here"),
    isEnabled: () => isProviderEnabled("groq"),
    visionModel: () => process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct",
    async stream(systemPrompt, history, cb) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-groq-key");
      return withModelFallback("groq", config.model, chat, (cfg) => streamOpenAICompat(cfg, "groq", systemPrompt, history, cb));
    },
    async complete(systemPrompt, history, timeoutMs = 30_000) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-groq-key");
      const { content } = await withModelFallback("groq", config.model, chat, (cfg) => completeOpenAICompat(cfg, "groq", systemPrompt, history, timeoutMs));
      return content;
    },
    async completeVision(prompt, imageBase64, mimeType, timeoutMs = 30_000) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-groq-key");
      const { content } = await completeOpenAICompat(
        chat(), "groq",
        VISION_SYSTEM_PROMPT,
        [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        }],
        timeoutMs,
        600
      );
      return content;
    },
    async completeWithTools(systemPrompt, history, tools, timeoutMs = 45_000, maxTokens = 2048) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-groq-key");
      return withModelFallback("groq", config.model, chat, (cfg) => completeOpenAICompat(cfg, "groq", systemPrompt, history, timeoutMs, maxTokens, tools));
    },
  };
}

function makeCerebras(): ProviderAdapter {
  const config: ModelConfig = {
    provider: "cerebras",
    model: process.env.CEREBRAS_MODEL || DEFAULT_MODELS.cerebras,
    label: `Cerebras · ${(process.env.CEREBRAS_MODEL || "Llama 3.3 70B").split("/").pop()}`,
    available: false,
  };
  const chat = (model?: string) => ({
    url: "https://api.cerebras.ai/v1/chat/completions",
    key: process.env.CEREBRAS_API_KEY ?? "",
    model: model || config.model,
  });
  return {
    config,
    isConfigured: () => realKey(process.env.CEREBRAS_API_KEY, "your-cerebras-key-here"),
    isEnabled: () => isProviderEnabled("cerebras"),
    visionModel: () => process.env.CEREBRAS_VISION_MODEL || "llama-4-scout-17b-16e-instruct",
    async stream(systemPrompt, history, cb) {
      const key = process.env.CEREBRAS_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-cerebras-key");
      return withModelFallback("cerebras", config.model, chat, (cfg) => streamOpenAICompat(cfg, "cerebras", systemPrompt, history, cb));
    },
    async complete(systemPrompt, history, timeoutMs = 30_000) {
      const key = process.env.CEREBRAS_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-cerebras-key");
      const { content } = await withModelFallback("cerebras", config.model, chat, (cfg) => completeOpenAICompat(cfg, "cerebras", systemPrompt, history, timeoutMs));
      return content;
    },
    async completeVision(prompt, imageBase64, mimeType, timeoutMs = 30_000) {
      const key = process.env.CEREBRAS_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-cerebras-key");
      const { content } = await completeOpenAICompat(
        chat(process.env.CEREBRAS_VISION_MODEL || "llama-4-scout-17b-16e-instruct"), "cerebras",
        VISION_SYSTEM_PROMPT,
        [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        }],
        timeoutMs,
        600
      );
      return content;
    },
    async completeWithTools(systemPrompt, history, tools, timeoutMs = 45_000, maxTokens = 2048) {
      const key = process.env.CEREBRAS_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-cerebras-key");
      return withModelFallback("cerebras", config.model, chat, (cfg) => completeOpenAICompat(cfg, "cerebras", systemPrompt, history, timeoutMs, maxTokens, tools));
    },
  };
}

function makeNvidia(): ProviderAdapter {
  const config: ModelConfig = {
    provider: "nvidia",
    model: process.env.NVIDIA_MODEL || DEFAULT_MODELS.nvidia,
    label: `NVIDIA · ${(process.env.NVIDIA_MODEL || "Llama 3.3 70B").split("/").pop()}`,
    available: false,
  };
  const chat = (model?: string) => ({
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    key: process.env.NVIDIA_API_KEY ?? "",
    model: model || config.model,
  });
  return {
    config,
    isConfigured: () => realKey(process.env.NVIDIA_API_KEY, "nvapi-your-key-here"),
    isEnabled: () => isProviderEnabled("nvidia"),
    visionModel: () => process.env.NVIDIA_VISION_MODEL || "meta/llama-3.2-90b-vision-instruct",
    async stream(systemPrompt, history, cb) {
      const key = process.env.NVIDIA_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-nvidia-key");
      return withModelFallback("nvidia", config.model, chat, (cfg) => streamOpenAICompat(cfg, "nvidia", systemPrompt, history, cb));
    },
    async complete(systemPrompt, history, timeoutMs = 30_000) {
      const key = process.env.NVIDIA_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-nvidia-key");
      const { content } = await withModelFallback("nvidia", config.model, chat, (cfg) => completeOpenAICompat(cfg, "nvidia", systemPrompt, history, timeoutMs));
      return content;
    },
    async completeVision(prompt, imageBase64, mimeType, timeoutMs = 30_000) {
      const key = process.env.NVIDIA_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-nvidia-key");
      const { content } = await completeOpenAICompat(
        chat(process.env.NVIDIA_VISION_MODEL || "meta/llama-3.2-90b-vision-instruct"), "nvidia",
        VISION_SYSTEM_PROMPT,
        [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        }],
        timeoutMs,
        600
      );
      return content;
    },
    async completeWithTools(systemPrompt, history, tools, timeoutMs = 45_000, maxTokens = 2048) {
      const key = process.env.NVIDIA_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-nvidia-key");
      return withModelFallback("nvidia", config.model, chat, (cfg) => completeOpenAICompat(cfg, "nvidia", systemPrompt, history, timeoutMs, maxTokens, tools));
    },
  };
}

function makeGemini(): ProviderAdapter {
  const config: ModelConfig = {
    provider: "gemini",
    model: process.env.GEMINI_MODEL || DEFAULT_MODELS.gemini,
    label: `Gemini · ${(process.env.GEMINI_MODEL || DEFAULT_MODELS.gemini).split("/").pop()}`,
    available: false,
  };
  const chat = (model?: string) => ({
    // Google's OFFICIAL OpenAI-compatible endpoint — same request shapes as
    // every other adapter, billed against Gemini's generous free tier.
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    key: process.env.GEMINI_API_KEY ?? "",
    model: model || config.model,
  });
  return {
    config,
    isConfigured: () => realKey(process.env.GEMINI_API_KEY, "your-gemini-key-here"),
    isEnabled: () => isProviderEnabled("gemini"),
    visionModel: () => process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
    async stream(systemPrompt, history, cb) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-gemini-key");
      return withModelFallback("gemini", config.model, chat, (cfg) => streamOpenAICompat(cfg, "gemini", systemPrompt, history, cb));
    },
    async complete(systemPrompt, history, timeoutMs = 30_000) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-gemini-key");
      const { content } = await withModelFallback("gemini", config.model, chat, (cfg) => completeOpenAICompat(cfg, "gemini", systemPrompt, history, timeoutMs));
      return content;
    },
    async completeVision(prompt, imageBase64, mimeType, timeoutMs = 30_000) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-gemini-key");
      const { content } = await completeOpenAICompat(
        chat(process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash"), "gemini",
        VISION_SYSTEM_PROMPT,
        [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        }],
        timeoutMs,
        600
      );
      return content;
    },
    async completeWithTools(systemPrompt, history, tools, timeoutMs = 45_000, maxTokens = 2048) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-gemini-key");
      return withModelFallback("gemini", config.model, chat, (cfg) => completeOpenAICompat(cfg, "gemini", systemPrompt, history, timeoutMs, maxTokens, tools));
    },
  };
}

function makeOllama(): ProviderAdapter {
  const config: ModelConfig = {
    provider: "ollama",
    model: process.env.QUIP_OLLAMA_MODEL || DEFAULT_MODELS.ollama,
    label: `Ollama · ${(process.env.QUIP_OLLAMA_MODEL || DEFAULT_MODELS.ollama)}`,
    available: false,
  };
  const chat = (model?: string) => ({
    // The laptop's own OpenAI-compatible server (Ollama app). No key, no
    // internet — the reason chat can survive a total outage.
    url: `${ollamaBaseUrl(process.env.QUIP_OLLAMA_URL)}/chat/completions`,
    key: "",
    model: model || config.model,
  });
  return {
    config,
    // No key to configure — reachability is the real test, and the circuit
    // breaker parks it fast (localhost connection-refused is instant) when
    // the Ollama app isn't running.
    isConfigured: () => true,
    isEnabled: () => isProviderEnabled("ollama"),
    visionModel: () => null,
    async stream(systemPrompt, history, cb) {
      return withModelFallback("ollama", config.model, chat, (cfg) => streamOpenAICompat(cfg, "ollama", systemPrompt, history, cb));
    },
    async complete(systemPrompt, history, timeoutMs = 30_000) {
      const { content } = await withModelFallback("ollama", config.model, chat, (cfg) => completeOpenAICompat(cfg, "ollama", systemPrompt, history, timeoutMs));
      return content;
    },
    async completeVision() {
      throw new ModelTransportError("no-key", "Ollama has no vision model configured in Quip");
    },
    async completeWithTools(systemPrompt, history, tools, timeoutMs = 45_000, maxTokens = 2048) {
      return withModelFallback("ollama", config.model, chat, (cfg) => completeOpenAICompat(cfg, "ollama", systemPrompt, history, timeoutMs, maxTokens, tools));
    },
  };
}

function makeOpenRouter(): ProviderAdapter {
  const config: ModelConfig = {
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODELS.openrouter,
    label: `OpenRouter · ${(process.env.OPENROUTER_MODEL || DEFAULT_MODELS.openrouter).split("/").pop()}`,
    available: false,
  };
  const chat = (model?: string) => ({
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: process.env.OPENROUTER_API_KEY ?? "",
    model: model || config.model,
    extraHeaders: { "HTTP-Referer": "https://quip.app", "X-Title": "Quip" },
  });
  return {
    config,
    isConfigured: () => realKey(process.env.OPENROUTER_API_KEY, "sk-or-v1-your-key-here"),
    isEnabled: () => isProviderEnabled("openrouter"),
    visionModel: () => process.env.OPENROUTER_VISION_MODEL || "qwen/qwen-2.5-vl-72b-instruct:free",
    async stream(systemPrompt, history, cb) {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-openrouter-key");
      return withModelFallback("openrouter", config.model, chat, (cfg) => streamOpenAICompat(cfg, "openrouter", systemPrompt, history, cb));
    },
    async complete(systemPrompt, history, timeoutMs = 30_000) {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-openrouter-key");
      const { content } = await withModelFallback("openrouter", config.model, chat, (cfg) => completeOpenAICompat(cfg, "openrouter", systemPrompt, history, timeoutMs));
      return content;
    },
    async completeVision(prompt, imageBase64, mimeType, timeoutMs = 30_000) {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-openrouter-key");
      const { content } = await completeOpenAICompat(
        chat(), "openrouter",
        VISION_SYSTEM_PROMPT,
        [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        }],
        timeoutMs,
        600
      );
      return content;
    },
    async completeWithTools(systemPrompt, history, tools, timeoutMs = 45_000, maxTokens = 2048) {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new ModelTransportError("no-key", "no-openrouter-key");
      return withModelFallback("openrouter", config.model, chat, (cfg) => completeOpenAICompat(cfg, "openrouter", systemPrompt, history, timeoutMs, maxTokens, tools));
    },
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function makeAdapters(): Record<string, ProviderAdapter> {
  return {
    groq: makeGroq(),
    gemini: makeGemini(),
    cerebras: makeCerebras(),
    nvidia: makeNvidia(),
    openrouter: makeOpenRouter(),
    ollama: makeOllama(),
  };
}

export class ModelRouter {
  private adapters: Record<string, ProviderAdapter> = {};
  private order: ProviderAdapter[] = []; // priority order (may include unconfigured)
  private activeProvider: ModelProvider = "groq";
  /** Circuit breaker — parks repeatedly-failing providers so every new
   *  message stops paying their timeout. Reset when ALL providers park. */
  readonly breaker = new CircuitBreaker();

  constructor() {
    this.rebuild();
  }

  /** Re-read the environment and rebuild the provider chain. Called on
   *  construction AND after Settings changes — no app restart needed. */
  reload(): void {
    this.rebuild();
  }

  private rebuild(): void {
    this.adapters = makeAdapters();
    const primaryPref = (process.env.QUIP_PRIMARY_PROVIDER || "").toLowerCase();

    // Base priority: explicit env override → Groq → Cerebras → NVIDIA → OpenRouter.
    const ids: string[] = [];
    if (primaryPref && this.adapters[primaryPref]) ids.push(primaryPref);
    for (const id of PROVIDER_ORDER) {
      if (!ids.includes(id)) ids.push(id);
    }
    this.order = ids.map((id) => this.adapters[id]).filter(Boolean);
    const firstUsable = this.order.find((p) => p.isEnabled() && p.isConfigured());
    this.activeProvider = firstUsable
      ? firstUsable.config.provider
      : (this.order[0]?.config.provider ?? "groq");
  }

  /** Ordered, configured+enabled providers — the live failover chain with
   *  circuit-broken (parked) providers filtered out. NO side effects — safe
   *  for status() and failure wrapping. */
  chain(): ProviderAdapter[] {
    return this.order
      .filter((p) => p.isEnabled() && p.isConfigured())
      .filter((p) => this.breaker.isAvailable(p.config.provider));
  }

  /** The chain for a NEW request: when EVERY usable provider is parked,
   *  all parks are cleared first — a fresh user message must always get at
   *  least one real attempt from the whole chain. */
  private requestChain(): ProviderAdapter[] {
    const raw = this.order.filter((p) => p.isEnabled() && p.isConfigured());
    const usable = raw.filter((p) => this.breaker.isAvailable(p.config.provider));
    if (raw.length > 0 && usable.length === 0) {
      this.breaker.resetAll();
      return raw;
    }
    return usable;
  }

  /**
   * Honest per-provider status lines for the failure trail — WHY each
   * provider was skipped. Only enabled providers appear (disabled ones are
   * a user choice, not a failure). Ollama needs no key — reachability is
   * reported instead of a missing key.
   */
  private skipNotes(): string[] {
    return this.order
      .filter((p) => p.isEnabled())
      .map((p) => {
        if (p.config.provider === "ollama") return null; // no key needed — silently skipped when off
        if (!p.isConfigured()) {
          return `${PROVIDER_LABEL[p.config.provider]}: ${keyMissingNote(PROVIDER_KEY_VAR_FOR(p.config.provider))}`;
        }
        const parkedFor = this.breaker.parkedForMs(p.config.provider);
        if (parkedFor > 0) {
          return `${PROVIDER_LABEL[p.config.provider]}: resting ${Math.ceil(parkedFor / 1000)}s after repeated failures (circuit breaker) — it rejoins automatically`;
        }
        return null;
      })
      .filter((s): s is string => !!s);
  }

  /** Stream a chat completion, trying each configured provider once (with one transient retry). */
  async stream(
    systemPrompt: string,
    history: { role: "user" | "assistant"; content: string }[],
    cb: StreamCallbacks
  ): Promise<{ full: string; provider: ModelProvider; switched: boolean }> {
    const providers = this.requestChain();
    const attempts: string[] = [];
    let lastErr: unknown = null;

    for (const p of providers) {
      const providerId = p.config.provider;
      cb.onProvider?.(providerId, false); // "trying X…"
      for (let attempt = 0; attempt < 2; attempt++) {
        const started = Date.now();
        try {
          const full = await p.stream(systemPrompt, history, cb);
          // A 200 stream that yields NOTHING is a failure, not a success —
          // the user used to get a silent empty bubble. Fail over honestly.
          if (!full || !full.trim()) {
            throw new ModelTransportError("http", `${PROVIDER_LABEL[providerId]} returned an empty reply`);
          }
          const switched = p.config.provider !== providers[0].config.provider;
          if (switched) attempts.push(`${PROVIDER_LABEL[providerId]} answered after ${PROVIDER_LABEL[providers[0].config.provider]} failed.`);
          this.activeProvider = providerId;
          this.breaker.recordSuccess(providerId);
          connectionJournal.record({
            provider: providerId,
            model: p.config.model,
            ok: true,
            kind: "none",
            latencyMs: Date.now() - started,
            note: switched ? `answered after ${PROVIDER_LABEL[providers[0].config.provider]} failed` : "",
            switched,
          });
          return { full, provider: providerId, switched };
        } catch (err: any) {
          lastErr = err;
          if (cb.signal?.aborted) throw err;
          const kind: ChatErrorKind = err instanceof ModelTransportError ? err.kind : "network";
          attempts.push(`${PROVIDER_LABEL[providerId]}: ${err?.message ?? err}`);
          connectionJournal.record({
            provider: providerId,
            model: p.config.model,
            ok: false,
            kind,
            latencyMs: Date.now() - started,
            note: String(err?.message ?? err).slice(0, 180),
          });
          this.breaker.recordFailure(providerId, {
            retryAfterMs: err instanceof ModelTransportError ? err.retryAfterMs ?? null : null,
            lastError: String(err?.message ?? err),
          });
          // Retry only transient network failures; auth/rate-limit/http move on.
          if (kind === "network" && attempt === 0) continue;
          break;
        }
      }
      if (cb.signal?.aborted) break;
    }

    throw this.wrapTotalFailure(lastErr, attempts);
  }

  status(): ModelRouterStatus {
    const chain = this.chain();
    const primary = chain[0] ?? this.order[0];
    const primaryCfg = { ...primary.config, available: primary.isConfigured() && primary.isEnabled() };
    const second = chain[1] ?? null;
    const fallback = second ? { ...second.config, available: true } : null;
    const active =
      chain.find((p) => p.config.provider === this.activeProvider) ?? primary;
    const activeCfg = { ...active.config, available: active.isConfigured() && active.isEnabled() };
    return {
      primary: primaryCfg,
      fallback,
      active: activeCfg,
      healthy: chain.length > 0,
      chain: chain.map((p) => ({ ...p.config, available: true })),
    };
  }

  /** Non-streaming completion with provider chain. Used by extraction/planning tasks. */
  async complete(
    systemPrompt: string,
    history: { role: "user" | "assistant"; content: string }[],
    timeoutMs?: number
  ): Promise<string> {
    const providers = this.requestChain();
    const attempts: string[] = this.skipNotes();
    let lastErr: unknown = null;
    for (const p of providers) {
      const started = Date.now();
      try {
        const result = await p.complete(systemPrompt, history, timeoutMs);
        this.activeProvider = p.config.provider;
        this.breaker.recordSuccess(p.config.provider);
        connectionJournal.record({ provider: p.config.provider, model: p.config.model, ok: true, kind: "none", latencyMs: Date.now() - started, note: "complete" });
        return result;
      } catch (err: any) {
        lastErr = err;
        attempts.push(`${PROVIDER_LABEL[p.config.provider]}: ${err?.message ?? err}`);
        connectionJournal.record({ provider: p.config.provider, model: p.config.model, ok: false, kind: err instanceof ModelTransportError ? err.kind : "network", latencyMs: Date.now() - started, note: String(err?.message ?? err).slice(0, 180) });
        this.breaker.recordFailure(p.config.provider, {
          retryAfterMs: err instanceof ModelTransportError ? err.retryAfterMs ?? null : null,
          lastError: String(err?.message ?? err),
        });
        const kind: ChatErrorKind = err instanceof ModelTransportError ? err.kind : "network";
        if (kind === "auth" || kind === "no-key") continue; // try next provider
        // rate-limit / network / timeout: brief single retry on same provider
        try {
          const result = await p.complete(systemPrompt, history, timeoutMs);
          this.activeProvider = p.config.provider;
          this.breaker.recordSuccess(p.config.provider);
          return result;
        } catch (err2) {
          lastErr = err2;
          attempts.push(`${PROVIDER_LABEL[p.config.provider]} retry: ${(err2 as Error)?.message ?? err2}`);
          this.breaker.recordFailure(p.config.provider, { lastError: String((err2 as Error)?.message ?? err2) });
        }
      }
    }
    throw this.wrapTotalFailure(lastErr, attempts);
  }

  /**
   * TOOL-CALLING completion — the agent loop's engine. Sends the message
   * history + tool schemas and returns either the assistant's text or the
   * tool calls it wants executed. Tries each configured provider in order.
   * Throws ModelTransportError when nothing answers.
   */
  async completeWithTools(
    systemPrompt: string,
    history: ChatPart[],
    tools: ToolSchema[],
    timeoutMs = 45_000,
    maxTokens = 2048
  ): Promise<{ content: string; toolCalls: ToolCall[]; provider: ModelProvider }> {
    const providers = this.requestChain();
    const attempts: string[] = this.skipNotes();
    let lastErr: unknown = null;
    for (const p of providers) {
      const started = Date.now();
      try {
        const { content, toolCalls } = await p.completeWithTools(systemPrompt, history, tools, timeoutMs, maxTokens);
        this.activeProvider = p.config.provider;
        this.breaker.recordSuccess(p.config.provider);
        connectionJournal.record({ provider: p.config.provider, model: p.config.model, ok: true, kind: "none", latencyMs: Date.now() - started, note: "tools" });
        return { content, toolCalls, provider: p.config.provider };
      } catch (err: any) {
        lastErr = err;
        attempts.push(`${PROVIDER_LABEL[p.config.provider]}: ${err?.message ?? err}`);
        connectionJournal.record({ provider: p.config.provider, model: p.config.model, ok: false, kind: err instanceof ModelTransportError ? err.kind : "network", latencyMs: Date.now() - started, note: String(err?.message ?? err).slice(0, 180) });
        this.breaker.recordFailure(p.config.provider, {
          retryAfterMs: err instanceof ModelTransportError ? err.retryAfterMs ?? null : null,
          lastError: String(err?.message ?? err),
        });
        const kind: ChatErrorKind = err instanceof ModelTransportError ? err.kind : "network";
        if (kind === "auth" || kind === "no-key") continue;
        // one transient retry on the same provider, then move on
        try {
          const { content, toolCalls } = await p.completeWithTools(systemPrompt, history, tools, timeoutMs, maxTokens);
          this.activeProvider = p.config.provider;
          this.breaker.recordSuccess(p.config.provider);
          return { content, toolCalls, provider: p.config.provider };
        } catch (err2) {
          lastErr = err2;
          attempts.push(`${PROVIDER_LABEL[p.config.provider]} retry: ${(err2 as Error)?.message ?? err2}`);
          this.breaker.recordFailure(p.config.provider, { lastError: String((err2 as Error)?.message ?? err2) });
        }
      }
    }
    throw this.wrapTotalFailure(lastErr, attempts);
  }

  /**
   * VISION completion — send one screenshot + prompt to the first provider
   * that has a working vision model (Groq llama-4 first). This is the
   * screen-understanding primitive: "look at the REAL screen and answer".
   */
  async completeVision(
    prompt: string,
    imageBase64: string,
    mimeType = "image/png",
    timeoutMs = 30_000
  ): Promise<{ text: string; provider: ModelProvider }> {
    const providers = this.requestChain();
    const attempts: string[] = this.skipNotes();
    let lastErr: unknown = null;
    for (const p of providers) {
      const vModel = p.visionModel();
      if (!vModel) continue;
      const started = Date.now();
      try {
        const text = await p.completeVision(prompt, imageBase64, mimeType, timeoutMs);
        this.activeProvider = p.config.provider;
        this.breaker.recordSuccess(p.config.provider);
        connectionJournal.record({ provider: p.config.provider, model: vModel, ok: true, kind: "none", latencyMs: Date.now() - started, note: "vision" });
        return { text, provider: p.config.provider };
      } catch (err: any) {
        lastErr = err;
        attempts.push(`${PROVIDER_LABEL[p.config.provider]} vision: ${err?.message ?? err}`);
        connectionJournal.record({ provider: p.config.provider, model: vModel, ok: false, kind: err instanceof ModelTransportError ? err.kind : "network", latencyMs: Date.now() - started, note: String(err?.message ?? err).slice(0, 180) });
        this.breaker.recordFailure(p.config.provider, {
          retryAfterMs: err instanceof ModelTransportError ? err.retryAfterMs ?? null : null,
          lastError: String(err?.message ?? err),
        });
        const kind: ChatErrorKind = err instanceof ModelTransportError ? err.kind : "network";
        if (kind === "auth" || kind === "no-key") continue;
        // one transient retry, then next provider
        try {
          const text = await p.completeVision(prompt, imageBase64, mimeType, timeoutMs);
          this.activeProvider = p.config.provider;
          this.breaker.recordSuccess(p.config.provider);
          return { text, provider: p.config.provider };
        } catch (err2) {
          lastErr = err2;
          this.breaker.recordFailure(p.config.provider, { lastError: String((err2 as Error)?.message ?? err2) });
        }
      }
    }
    throw this.wrapTotalFailure(lastErr, attempts, "No vision-capable provider configured");
  }

  /** Which model would answer vision requests right now (for honest status). */
  activeVisionModel(): string | null {
    const providers = this.chain();
    for (const p of providers) {
      const v = p.visionModel();
      if (v) return v;
    }
    return null;
  }

  /** Wrap a chain-total failure into one error carrying the honest trail. */
  private wrapTotalFailure(lastErr: unknown, attempts: string[], fallbackMsg?: string): ModelTransportError {
    if (lastErr instanceof ModelTransportError && lastErr.attempts.length > 0) {
      return lastErr;
    }
    const kind: ChatErrorKind = lastErr instanceof ModelTransportError ? lastErr.kind : "no-key";
    const retryAfter = lastErr instanceof ModelTransportError ? lastErr.retryAfterMs ?? null : null;
    const trail = [...attempts, ...this.skipNotes()];
    // "Configured" means a key exists and the provider is enabled — circuit
    // breaker parks do NOT change that (they clear on the next request).
    const configuredCount = this.order.filter((p) => p.isEnabled() && p.isConfigured()).length;
    const msg = fallbackMsg ?? (configuredCount === 0
      ? "No AI provider is configured yet — add a key in Settings → AI Brain."
      : "I couldn't get an answer from any of your AI providers.");
    const wrapped = new ModelTransportError(kind, msg, trail);
    // Preserve the provider's own 429 wait instruction — the breaker and the
    // chat error UI both need it even after the trail is wrapped.
    wrapped.retryAfterMs = retryAfter;
    return wrapped;
  }

  /** Masked diagnostics — safe to log/show. Never includes raw keys. */
  diagnostics(): string {
    const s = this.status();
    return [
      `provider=${s.active.provider}`,
      `model=${s.active.model}`,
      `groqKey=${maskSecret(process.env.GROQ_API_KEY)}`,
      `geminiKey=${maskSecret(process.env.GEMINI_API_KEY)}`,
      `cerebrasKey=${maskSecret(process.env.CEREBRAS_API_KEY)}`,
      `nvidiaKey=${maskSecret(process.env.NVIDIA_API_KEY)}`,
      `openrouterKey=${maskSecret(process.env.OPENROUTER_API_KEY)}`,
      `ollama=${process.env.QUIP_OLLAMA_ENABLED === "1" ? "on" : "off"}`,
      `transport=${transportMode()}`,
      `breaker=${JSON.stringify(this.breaker.snapshot())}`,
    ].join(" ");
  }
}

/** Env var name for a provider's key (local helper — avoids an import cycle). */
function PROVIDER_KEY_VAR_FOR(provider: ModelProvider): string {
  switch (provider) {
    case "groq": return "GROQ_API_KEY";
    case "gemini": return "GEMINI_API_KEY";
    case "cerebras": return "CEREBRAS_API_KEY";
    case "nvidia": return "NVIDIA_API_KEY";
    case "openrouter": return "OPENROUTER_API_KEY";
    default: return "API_KEY";
  }
}

/** Map a model error to a calm, actionable user message (no raw internals). */
export const describeError = describeErrorPure;

export const modelRouter = new ModelRouter();
