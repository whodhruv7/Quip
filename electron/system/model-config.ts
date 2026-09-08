// Quip V2 — MODEL CONFIG (pure helpers)
// -----------------------------------------------------------------------------
// Pure, dependency-free helpers shared by the model router and tests.
// No Electron imports here — this module must be importable in plain Node
// so error mapping / secret masking can be regression-tested.
// -----------------------------------------------------------------------------

export type ChatErrorKindPure = "no-key" | "auth" | "rate-limit" | "http" | "network" | "timeout";

/** Mask a secret for diagnostics: "sk-o...9xKf" — never the full value. */
export function maskSecret(value: string | undefined): string {
  if (!value) return "missing";
  if (value.length <= 8) return "present";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/** Map a model error to a calm, actionable user message (no raw internals). */
export function describeError(err: unknown): { message: string; kind: ChatErrorKindPure } {
  const kind: ChatErrorKindPure =
    err && typeof err === "object" && "kind" in err && typeof (err as any).kind === "string"
      ? (err as any).kind
      : "network";
  switch (kind) {
    case "no-key":
      return {
        kind,
        message: "I can't reach my brain yet — no AI key is configured. Open Settings → AI Brain to paste a free key (takes 30 seconds).",
      };
    case "auth":
      return {
        kind,
        message: "The AI provider rejected the API key. Open Settings → AI Brain, re-paste the key and use Test connection.",
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
export function defaultOpenRouterModel(): string {
  return "minimax/minimax-m3:free";
}
