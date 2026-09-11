// Quip V3 — provider probe (pure-ish, no Electron imports).
// ─────────────────────────────────────────────────────────────────────────────
// "Test connection" for the Settings AI tab. Makes ONE real minimal request
// to the chosen provider and reports the honest outcome — never fakes
// success. Injectable fetch keeps it regression-testable.
//
// V3 diagnostics upgrade: every failure now carries the provider's OWN
// error words (sanitized) so "why can't I connect" always has a concrete
// answer — bad key, rate limit, dead model, region block, anything.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  kind: "auth" | "rate-limit" | "http" | "network" | "timeout" | "no-key" | "none";
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
  if (status === 429) return "rate-limit";
  return "http";
}

/** Pull the provider's own error words out of a JSON-ish body, safely. */
export function providerErrorSnippet(body: string): string {
  if (!body) return "";
  try {
    const json = JSON.parse(body);
    const candidates = [
      json?.error?.message,
      json?.error?.metadata?.raw,
      json?.message,
      json?.detail,
      json?.errors?.[0]?.message,
    ];
    const found = candidates.find((c) => typeof c === "string" && c.trim().length > 0);
    if (found) {
      return found.replace(/\s+/g, " ").slice(0, 160);
    }
  } catch {
    /* not JSON — fall through to raw snippet */
  }
  const clean = body.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 160) : "";
}

function messageFor(
  kind: ProbeResult["kind"],
  provider: string,
  status: number,
  body: string
): string {
  const snippet = providerErrorSnippet(body);
  switch (kind) {
    case "auth":
      return `The ${provider} rejected this key (HTTP ${status}). Double-check you copied the whole key.${snippet ? ` — ${provider} says: ${snippet}` : ""}`;
    case "rate-limit":
      return `${provider} is rate limiting this key (HTTP 429). Wait a bit and retry — or switch to another provider.${snippet ? ` — ${snippet}` : ""}`;
    case "timeout":
      return `${provider} didn't respond within ${DEFAULT_TIMEOUT_MS / 1000}s. Check your connection and try again.`;
    case "network":
      return `Couldn't reach ${provider}. Check your internet connection (or a firewall is blocking it).`;
    case "http":
      return `${provider} refused the request (HTTP ${status}).${snippet ? ` — ${snippet}` : " Try again in a moment."}`;
    default:
      return "Unknown response.";
  }
}

/** A real chat-completions probe — proves the key AND the model id at once. */
async function probeChatCompletion(
  label: string,
  url: string,
  apiKey: string,
  model: string,
  extraHeaders: Record<string, string> | undefined,
  fetchImpl: FetchLike
): Promise<ProbeResult> {
  const started = Date.now();
  if (!apiKey) {
    return { ok: false, latencyMs: 0, kind: "no-key", message: `No key to test — paste your ${label} key first.` };
  }
  const res = await timedFetch(fetchImpl, url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(extraHeaders ?? {}),
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
    const snippet = providerErrorSnippet(res.body);
    return { ok: false, latencyMs, kind: "http", message: `The model id "${model}" was rejected by ${label}.${snippet ? ` — ${snippet}` : " Pick a model from the Browse models list."}` };
  }
  return { ok: false, latencyMs, kind, message: messageFor(kind, label, res.status, res.body) };
}

/** A models-list probe — cheap, real, proves the key (no tokens spent). */
async function probeModelsList(
  label: string,
  url: string,
  apiKey: string,
  extraHeaders: Record<string, string> | undefined,
  fetchImpl: FetchLike
): Promise<ProbeResult> {
  const started = Date.now();
  if (!apiKey) {
    return { ok: false, latencyMs: 0, kind: "no-key", message: `No key to test — paste your ${label} key first.` };
  }
  const res = await timedFetch(fetchImpl, url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, ...(extraHeaders ?? {}) },
  });
  const latencyMs = Date.now() - started;
  if (res.status >= 200 && res.status < 300) {
    let count = "";
    try {
      const data = JSON.parse(res.body);
      const n = Array.isArray(data?.data) ? data.data.length : null;
      if (n != null) count = ` — ${n} models available`;
    } catch {
      /* fine without a count */
    }
    return { ok: true, latencyMs, kind: "none", message: `Connected to ${label} in ${(latencyMs / 1000).toFixed(1)}s${count}.` };
  }
  const kind = classify(res.status, res.error);
  return { ok: false, latencyMs, kind, message: messageFor(kind, label, res.status, res.body) };
}

/** Probe OpenRouter with a 1-token completion — proves the key AND the model id. */
export async function probeOpenRouter(
  apiKey: string,
  model: string,
  fetchImpl: FetchLike = fetch
): Promise<ProbeResult> {
  return probeChatCompletion(
    "OpenRouter",
    "https://openrouter.ai/api/v1/chat/completions",
    apiKey,
    model,
    { "HTTP-Referer": "https://quip.app", "X-Title": "Quip" },
    fetchImpl
  );
}

/** Probe Groq with a models-list GET — cheap, real, proves the key. */
export async function probeGroq(
  apiKey: string,
  _model: string,
  fetchImpl: FetchLike = fetch
): Promise<ProbeResult> {
  return probeModelsList("Groq", "https://api.groq.com/openai/v1/models", apiKey, undefined, fetchImpl);
}

/** Probe Cerebras with a models-list GET — cheap, real, proves the key. */
export async function probeCerebras(
  apiKey: string,
  _model: string,
  fetchImpl: FetchLike = fetch
): Promise<ProbeResult> {
  return probeModelsList("Cerebras", "https://api.cerebras.ai/v1/models", apiKey, undefined, fetchImpl);
}

/** Probe NVIDIA NIM with a models-list GET — cheap, real, proves the key. */
export async function probeNvidia(
  apiKey: string,
  _model: string,
  fetchImpl: FetchLike = fetch
): Promise<ProbeResult> {
  return probeModelsList("NVIDIA", "https://integrate.api.nvidia.com/v1/models", apiKey, undefined, fetchImpl);
}

export type ProbeProviderId = "openrouter" | "groq" | "cerebras" | "nvidia";

export async function probeProvider(
  provider: ProbeProviderId,
  apiKey: string,
  model: string,
  fetchImpl: FetchLike = fetch
): Promise<ProbeResult> {
  switch (provider) {
    case "groq":
      return probeGroq(apiKey, model, fetchImpl);
    case "cerebras":
      return probeCerebras(apiKey, model, fetchImpl);
    case "nvidia":
      return probeNvidia(apiKey, model, fetchImpl);
    default:
      return probeOpenRouter(apiKey, model, fetchImpl);
  }
}
