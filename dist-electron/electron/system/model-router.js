"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelRouter = exports.describeError = exports.ModelRouter = exports.ModelTransportError = exports.maskSecret = void 0;
const electron_1 = require("electron");
const model_config_1 = require("./model-config");
var model_config_2 = require("./model-config");
Object.defineProperty(exports, "maskSecret", { enumerable: true, get: function () { return model_config_2.maskSecret; } });
/** Error with a stable machine-readable kind (used by IPC error mapping). */
class ModelTransportError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.kind = kind;
    }
}
exports.ModelTransportError = ModelTransportError;
const REQUEST_TIMEOUT_MS = 60_000;
// ---------------------------------------------------------------------------
// Transport — Node fetch with Electron net.fetch TLS fallback.
// Some Windows setups (AV inspection, corporate proxies) break Node's TLS.
// Electron's net.fetch uses Chromium's network stack + OS cert store.
// ---------------------------------------------------------------------------
function isTlsError(err) {
    const msg = String(err?.message ?? err);
    return (msg.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE") ||
        msg.includes("SELF_SIGNED_CERT_IN_CHAIN") ||
        msg.includes("CERT_HAS_EXPIRED") ||
        msg.includes("DEPTH_ZERO_SELF_SIGNED_CERT") ||
        msg.includes("unable to verify the first certificate") ||
        msg.includes("ERR_TLS_CERT_ALTNAME_INVALID") ||
        msg.includes("certificate"));
}
async function modelFetch(url, init) {
    try {
        return await fetch(url, init);
    }
    catch (error) {
        if (isTlsError(error)) {
            // Electron net.fetch — uses OS trust store. Only for the TLS failure path.
            return await electron_1.net.fetch(url, init);
        }
        throw error;
    }
}
function classifyStatus(provider, status) {
    if (status === 401 || status === 403)
        return "auth";
    if (status === 429)
        return "rate-limit";
    if (status >= 500)
        return "http";
    return "http";
}
function buildBody(cfg, systemPrompt, history, stream, maxTokens) {
    return JSON.stringify({
        model: cfg.model,
        stream,
        messages: [{ role: "system", content: systemPrompt }, ...history],
        ...(stream ? {} : { temperature: 0.3, max_tokens: maxTokens ?? 1000 }),
    });
}
async function streamOpenAICompat(cfg, provider, systemPrompt, history, cb) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    if (cb.signal)
        cb.signal.addEventListener("abort", () => controller.abort());
    try {
        let resp;
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
        }
        catch (err) {
            if (controller.signal.aborted && cb.signal?.aborted)
                throw err; // user aborted
            if (err?.name === "AbortError") {
                throw new ModelTransportError("timeout", `${provider} request timed out`);
            }
            throw new ModelTransportError("network", `${provider} unreachable: ${err?.message ?? err}`);
        }
        if (!resp.ok || !resp.body) {
            const text = await resp.text().catch(() => "");
            throw new ModelTransportError(classifyStatus(provider, resp.status), `${provider}-http-${resp.status}`);
        }
        return await readSSE(resp.body, cb.onChunk);
    }
    finally {
        clearTimeout(timeout);
    }
}
async function completeOpenAICompat(cfg, provider, systemPrompt, history, timeoutMs = 30_000, maxTokens = 1000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let resp;
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
        }
        catch (err) {
            if (err?.name === "AbortError") {
                throw new ModelTransportError("timeout", `${provider} request timed out`);
            }
            throw new ModelTransportError("network", `${provider} unreachable: ${err?.message ?? err}`);
        }
        if (!resp.ok) {
            throw new ModelTransportError(classifyStatus(provider, resp.status), `${provider}-http-${resp.status}`);
        }
        const data = await resp.json();
        return data?.choices?.[0]?.message?.content ?? "";
    }
    finally {
        clearTimeout(timeout);
    }
}
// ---------------------------------------------------------------------------
// SSE reader — shared by both OpenAI-compatible providers.
// ---------------------------------------------------------------------------
async function readSSE(body, onChunk) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:"))
                continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]")
                continue;
            try {
                const json = JSON.parse(data);
                const delta = json?.choices?.[0]?.delta?.content ?? "";
                if (delta) {
                    full += delta;
                    onChunk(delta);
                }
            }
            catch {
                /* partial JSON — ignore */
            }
        }
    }
    return full;
}
// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------
function makeGroq() {
    const config = {
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
            if (!key)
                throw new ModelTransportError("no-key", "no-groq-key");
            return streamOpenAICompat({ url: "https://api.groq.com/openai/v1/chat/completions", key, model: config.model }, "groq", systemPrompt, history, cb);
        },
        async complete(systemPrompt, history, timeoutMs = 30_000) {
            const key = process.env.GROQ_API_KEY;
            if (!key)
                throw new ModelTransportError("no-key", "no-groq-key");
            return completeOpenAICompat({ url: "https://api.groq.com/openai/v1/chat/completions", key, model: config.model }, "groq", systemPrompt, history, timeoutMs);
        },
    };
}
function makeOpenRouter() {
    const config = {
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
            if (!key)
                throw new ModelTransportError("no-key", "no-openrouter-key");
            return streamOpenAICompat({
                url: "https://openrouter.ai/api/v1/chat/completions",
                key,
                model: config.model,
                extraHeaders: { "HTTP-Referer": "https://quip.app", "X-Title": "Quip" },
            }, "openrouter", systemPrompt, history, cb);
        },
        async complete(systemPrompt, history, timeoutMs = 30_000) {
            const key = process.env.OPENROUTER_API_KEY;
            if (!key)
                throw new ModelTransportError("no-key", "no-openrouter-key");
            return completeOpenAICompat({
                url: "https://openrouter.ai/api/v1/chat/completions",
                key,
                model: config.model,
                extraHeaders: { "HTTP-Referer": "https://quip.app", "X-Title": "Quip" },
            }, "openrouter", systemPrompt, history, timeoutMs);
        },
    };
}
// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
class ModelRouter {
    primary;
    fallback;
    activeProvider = "groq";
    constructor() {
        const groq = makeGroq();
        const openrouter = makeOpenRouter();
        const primaryPref = (process.env.QUIP_PRIMARY_PROVIDER || "").toLowerCase();
        // Provider order: explicit env override → whichever is configured → OpenRouter first.
        if (primaryPref === "groq") {
            this.primary = groq;
            this.fallback = openrouter;
        }
        else if (primaryPref === "openrouter") {
            this.primary = openrouter;
            this.fallback = groq;
        }
        else if (openrouter.isConfigured()) {
            this.primary = openrouter;
            this.fallback = groq;
        }
        else {
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
    chain() {
        const list = [];
        if (this.primary.isConfigured())
            list.push(this.primary);
        if (this.fallback && this.fallback.isConfigured() && this.fallback !== this.primary) {
            list.push(this.fallback);
        }
        return list;
    }
    /** Stream a chat completion, trying each configured provider once (with one transient retry). */
    async stream(systemPrompt, history, cb) {
        const providers = this.chain();
        let lastErr = null;
        for (const p of providers) {
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const full = await p.stream(systemPrompt, history, cb);
                    this.activeProvider = p.config.provider;
                    return { full, provider: p.config.provider };
                }
                catch (err) {
                    lastErr = err;
                    if (cb.signal?.aborted)
                        throw err;
                    const kind = err instanceof ModelTransportError ? err.kind : "network";
                    // Retry only transient network failures; auth/rate-limit/http move on.
                    if (kind === "network" && attempt === 0)
                        continue;
                    break;
                }
            }
            if (cb.signal?.aborted)
                break;
        }
        throw lastErr ?? new ModelTransportError("no-key", "No AI provider configured");
    }
    status() {
        const primary = { ...this.primary.config, available: this.primary.isConfigured() };
        const fallback = this.fallback
            ? { ...this.fallback.config, available: this.fallback.isConfigured() }
            : null;
        const active = this.activeProvider === primary.provider
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
    async complete(systemPrompt, history, timeoutMs) {
        const providers = this.chain();
        let lastErr = null;
        for (const p of providers) {
            try {
                const result = await p.complete(systemPrompt, history, timeoutMs);
                this.activeProvider = p.config.provider;
                return result;
            }
            catch (err) {
                lastErr = err;
                const kind = err instanceof ModelTransportError ? err.kind : "network";
                if (kind === "auth" || kind === "no-key")
                    continue; // try next provider
                // rate-limit / network / timeout: brief single retry on same provider
                try {
                    const result = await p.complete(systemPrompt, history, timeoutMs);
                    this.activeProvider = p.config.provider;
                    return result;
                }
                catch (err2) {
                    lastErr = err2;
                }
            }
        }
        throw lastErr ?? new ModelTransportError("no-key", "No AI provider configured");
    }
    /** Masked diagnostics — safe to log/show. Never includes raw keys. */
    diagnostics() {
        const s = this.status();
        return [
            `provider=${s.active.provider}`,
            `model=${s.active.model}`,
            `groqKey=${(0, model_config_1.maskSecret)(process.env.GROQ_API_KEY)}`,
            `openrouterKey=${(0, model_config_1.maskSecret)(process.env.OPENROUTER_API_KEY)}`,
        ].join(" ");
    }
}
exports.ModelRouter = ModelRouter;
/** Map a model error to a calm, actionable user message (no raw internals). */
exports.describeError = model_config_1.describeError;
exports.modelRouter = new ModelRouter();
//# sourceMappingURL=model-router.js.map