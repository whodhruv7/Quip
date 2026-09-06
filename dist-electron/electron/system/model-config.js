"use strict";
// Quip V2 — MODEL CONFIG (pure helpers)
// -----------------------------------------------------------------------------
// Pure, dependency-free helpers shared by the model router and tests.
// No Electron imports here — this module must be importable in plain Node
// so error mapping / secret masking can be regression-tested.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskSecret = maskSecret;
exports.describeError = describeError;
exports.defaultOpenRouterModel = defaultOpenRouterModel;
/** Mask a secret for diagnostics: "sk-o...9xKf" — never the full value. */
function maskSecret(value) {
    if (!value)
        return "missing";
    if (value.length <= 8)
        return "present";
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
/** Map a model error to a calm, actionable user message (no raw internals). */
function describeError(err) {
    const kind = err && typeof err === "object" && "kind" in err && typeof err.kind === "string"
        ? err.kind
        : "network";
    switch (kind) {
        case "no-key":
            return {
                kind,
                message: "I can't reach my brain yet — no AI key is configured. Add GROQ_API_KEY or OPENROUTER_API_KEY to your .env file.",
            };
        case "auth":
            return {
                kind,
                message: "The AI provider rejected the API key. Check the key in your .env file.",
            };
        case "rate-limit":
            return {
                kind,
                message: "The AI provider is rate limiting us. Give it a moment and try again.",
            };
        case "timeout":
            return { kind, message: "The request timed out. Try again in a moment." };
        case "http":
            return {
                kind,
                message: "The AI provider had a temporary problem. Try again in a moment.",
            };
        case "network":
        default:
            return {
                kind,
                message: "I couldn't reach the network. Check your connection and try again.",
            };
    }
}
/** The default OpenRouter model — must never regress to a stale model name. */
function defaultOpenRouterModel() {
    return "minimax/minimax-m3:free";
}
//# sourceMappingURL=model-config.js.map