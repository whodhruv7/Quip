// Quip V3 — provider model discovery (pure, injectable fetch).
// ─────────────────────────────────────────────────────────────────────────────
// "Figure out what models they have automatically": GET /models on each
// OpenAI-compatible provider and return the full model-id list the user's
// key can actually reach. Powers the Settings model browser (scroll through
// every model and pick one). Short-lived cache keeps it snappy; no key ever
// leaves the main process and no key is ever logged.
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoveredModel {
  id: string;
  /** Owner/organization field when the provider exposes one (e.g. "meta"). */
  ownedBy?: string;
}

export interface DiscoverResult {
  ok: boolean;
  models: DiscoveredModel[];
  message: string;
}

type FetchLike = (url: string, init?: any) => Promise<any>;

const TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  at: number;
  result: DiscoverResult;
}
const cache = new Map<string, CacheEntry>();

interface Endpoint {
  url: string;
  headers: Record<string, string>;
}

function endpointFor(provider: string, apiKey: string): Endpoint | null {
  switch (provider) {
    case "groq":
      return { url: "https://api.groq.com/openai/v1/models", headers: auth(apiKey) };
    case "cerebras":
      return { url: "https://api.cerebras.ai/v1/models", headers: auth(apiKey) };
    case "nvidia":
      return { url: "https://integrate.api.nvidia.com/v1/models", headers: auth(apiKey) };
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/models",
        headers: {
          // OpenRouter lists models without a key too; sending it filters to
          // what THIS account can actually call (e.g. :free eligibility).
          ...auth(apiKey),
          "HTTP-Referer": "https://quip.app",
          "X-Title": "Quip",
        },
      };
    default:
      return null;
  }
}

function auth(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/** Friendly provider names for messages. */
function labelFor(provider: string): string {
  const labels: Record<string, string> = {
    groq: "Groq",
    cerebras: "Cerebras",
    nvidia: "NVIDIA",
    openrouter: "OpenRouter",
  };
  return labels[provider] ?? provider;
}

function sortModels(models: DiscoveredModel[]): DiscoveredModel[] {
  return models.slice().sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Fetch the model list for one provider. Returns ok=false with an honest
 * message (including the provider's own error words) when it fails.
 */
export async function discoverModels(
  provider: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<DiscoverResult> {
  const ep = endpointFor(provider, apiKey);
  if (!ep) {
    return { ok: false, models: [], message: `Unknown provider "${provider}".` };
  }

  const cacheKey = `${provider}:${apiKey ? "keyed" : "plain"}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.result;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: any;
    try {
      res = await fetchImpl(ep.url, {
        method: "GET",
        headers: ep.headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.text();
        try {
          const json = JSON.parse(body);
          detail = json?.error?.message ?? json?.message ?? "";
        } catch {
          detail = body.slice(0, 120);
        }
      } catch {
        /* no body */
      }
      const kind =
        res.status === 401 || res.status === 403
          ? "This key was rejected (HTTP 401/403). Re-paste the key and use Test connection."
          : res.status === 429
            ? "Rate limited (HTTP 429) — wait a moment and refresh."
            : `Request failed (HTTP ${res.status}).`;
      const result: DiscoverResult = {
        ok: false,
        models: [],
        message: `Couldn't load ${labelFor(provider)} models. ${kind}${detail ? ` — ${String(detail).replace(/\s+/g, " ").slice(0, 140)}` : ""}`,
      };
      return result;
    }

    const data = JSON.parse(await res.text());
    const rows: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const models: DiscoveredModel[] = rows
      .map((m) => ({
        id: String(m?.id ?? m?.model ?? "").trim(),
        ownedBy: typeof m?.owned_by === "string" ? m.owned_by : undefined,
      }))
      .filter((m) => m.id.length > 0);

    const result: DiscoverResult = {
      ok: true,
      models: sortModels(models),
      message: `${models.length} models on ${labelFor(provider)}.`,
    };
    cache.set(cacheKey, { at: Date.now(), result });
    return result;
  } catch (e: any) {
    const timedOut = e?.name === "AbortError" || /abort/i.test(String(e?.message ?? ""));
    return {
      ok: false,
      models: [],
      message: timedOut
        ? `${labelFor(provider)} didn't answer within ${TIMEOUT_MS / 1000}s — check your connection and retry.`
        : `Couldn't reach ${labelFor(provider)}: ${String(e?.message ?? e).slice(0, 140)}`,
    };
  }
}

/** Test hook — clear the in-memory cache. */
export function clearModelCache(): void {
  cache.clear();
}
