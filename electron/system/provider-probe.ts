// Quip V2 — provider probe (pure-ish, no Electron imports).
// ─────────────────────────────────────────────────────────────────────────────
// "Test connection" for the Settings AI tab. Makes ONE real minimal request
// to the chosen provider and reports the honest outcome — never fakes
// success. Injectable fetch keeps it regression-testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  kind: "auth" | "http" | "network" | "timeout" | "no-key" | "none";
  message: string;
}

type FetchLike = (url: string, init?: any) => Promise<any>;

const DEFAULT_TIMEOUT_MS = 10_000;

async function timedFetch(
  fetchImpl: FetchLike,
  url: string,
  init: Record<string, any>
): Promise<{ status: number; body: string; error?: "timeout" | "network" }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = typeof res?.text === "function" ? await res.text() : String(res?.body ?? "");
    return { status: res?.status ?? 0, body };
  } catch (e: any) {
    const timedOut = e?.name === "AbortError" || /abort/i.test(String(e?.message ?? ""));
    return { status: 0, body: "", error: timedOut ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

function classify(status: number, error?: "timeout" | "network"): ProbeResult["kind"] {
  if (error === "timeout") return "timeout";
  if (error === "network") return "network";
  if (status === 401 || status === 403) return "auth";
  return "http";
}

function messageFor(kind: ProbeResult["kind"], provider: string, status: number): string {
  switch (kind) {
    case "auth":
      return `The ${provider} rejected this key (HTTP ${status}). Double-check you copied the whole key.`;
    case "timeout":
      return `${provider} didn't respond within ${DEFAULT_TIMEOUT_MS / 1000}s. Check your connection and try again.`;
    case "network":
      return `Couldn't reach ${provider}. Check your internet connection.`;
    case "http":
      return `${provider} had a temporary problem (HTTP ${status}). Try again in a moment.`;
    default:
      return "Unknown response.";
  }
}

/** Probe OpenRouter with a 1-token completion — proves the key AND the model id. */
export async function probeOpenRouter(
  apiKey: string,
  model: string,
  fetchImpl: FetchLike = fetch
): Promise<ProbeResult> {
  const started = Date.now();
  if (!apiKey) {
    return { ok: false, latencyMs: 0, kind: "no-key", message: "No key to test — paste your OpenRouter key first." };
  }
  const res = await timedFetch(fetchImpl, "https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  const latencyMs = Date.now() - started;
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, latencyMs, kind: "none", message: `Connected — ${model} answered in ${(latencyMs / 1000).toFixed(1)}s.` };
  }
  const kind = classify(res.status, res.error);
  // A model-id mistake surfaces as 400; call it out honestly.
  if (res.status === 400 && /model/i.test(res.body)) {
    return { ok: false, latencyMs, kind: "http", message: `The model id "${model}" was rejected by OpenRouter. Check the model name.` };
  }
  return { ok: false, latencyMs, kind, message: messageFor(kind, "OpenRouter", res.status) };
}

/** Probe Groq with a models-list GET — cheap, real, proves the key. */
export async function probeGroq(
  apiKey: string,
  _model: string,
  fetchImpl: FetchLike = fetch
): Promise<ProbeResult> {
  const started = Date.now();
  if (!apiKey) {
    return { ok: false, latencyMs: 0, kind: "no-key", message: "No key to test — paste your Groq key first." };
  }
  const res = await timedFetch(fetchImpl, "https://api.groq.com/openai/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const latencyMs = Date.now() - started;
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, latencyMs, kind: "none", message: `Connected to Groq in ${(latencyMs / 1000).toFixed(1)}s.` };
  }
  const kind = classify(res.status, res.error);
  return { ok: false, latencyMs, kind, message: messageFor(kind, "Groq", res.status) };
}

export async function probeProvider(
  provider: "openrouter" | "groq",
  apiKey: string,
  model: string,
  fetchImpl: FetchLike = fetch
): Promise<ProbeResult> {
  return provider === "groq"
    ? probeGroq(apiKey, model, fetchImpl)
    : probeOpenRouter(apiKey, model, fetchImpl);
}
