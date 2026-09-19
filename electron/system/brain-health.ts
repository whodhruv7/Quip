// Quip V3.1 — brain health + Doctor report (pure aggregation, injectable IO).
// ─────────────────────────────────────────────────────────────────────────────
// The Doctor answers ONE question honestly: "why can't Quip reach my AI
// providers RIGHT NOW?" It checks, in order:
//   1. Can this laptop reach the internet at all from inside the app?
//      (probes a well-known endpoint WITHOUT a key — a 401 means the network
//      path is alive; a network error means the app itself is offline /
//      blocked by a firewall/VPN/AV — the single most misdiagnosed case)
//   2. Each provider: configured? enabled? parked by the breaker? — then a
//      REAL 1-token probe with the SAME key the router uses.
//   3. The voice engines (Groq TTS / Edge neural / laptop SAPI).
//   4. The connection journal tail (evidence, not vibes).
//   5. .env conflicts (a stale repo key vs the Settings key — the classic
//      "test passes but chat fails" trap, now surfaced loudly).
// Keys are NEVER included in the report — masked fingerprints only.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProviderHealthRow {
  provider: string;
  label: string;
  configured: boolean;
  enabled: boolean;
  parkedForMs: number;
  ok: boolean;
  latencyMs: number;
  kind: string;
  message: string;
  model: string;
}

export interface BrainHealthReport {
  at: number;
  network: { ok: boolean; message: string };
  providers: ProviderHealthRow[];
  working: string[];
  verdict: string;
  suggestions: string[];
}

type FetchLike = (url: string, init?: any) => Promise<any>;

const NETWORK_PROBE_URL = "https://api.groq.com/openai/v1/models";
const NETWORK_PROBE_TIMEOUT = 8000;

/** No key, no tokens — a 401/403 proves the internet path works from inside
 *  the app. A network error proves it doesn't (firewall/VPN/DNS/offline). */
export async function probeNetworkPath(fetchImpl: FetchLike = fetch): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_PROBE_TIMEOUT);
  try {
    const res = await fetchImpl(NETWORK_PROBE_URL, {
      method: "GET",
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: true, message: `Internet path is alive from inside the app (HTTP ${res.status} = server reachable).` };
    }
    return { ok: true, message: `Internet reachable (HTTP ${res.status}).` };
  } catch (e: any) {
    const timedOut = e?.name === "AbortError" || /abort/i.test(String(e?.message ?? ""));
    return {
      ok: false,
      message: timedOut
        ? "The internet probe timed out — this app can't reach the network (VPN/proxy/firewall/antivirus or offline). Every provider will fail until this is fixed."
        : `This app can't reach the network: ${String(e?.message ?? e).slice(0, 140)} (VPN/proxy/firewall/antivirus or offline).`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function buildVerdict(network: { ok: boolean }, providers: ProviderHealthRow[], suggestions: string[]): string {
  const working = providers.filter((p) => p.ok);
  if (working.length > 0) {
    return `${working.length} provider${working.length === 1 ? "" : "s"} working (${working.map((p) => p.label).join(", ")}) — chat is healthy.`;
  }
  if (!network.ok) {
    return "No provider can work: this app cannot reach the internet. Fix the network first (VPN/proxy/firewall/antivirus).";
  }
  if (providers.length === 0) {
    return "No provider is configured yet — paste at least one free API key in Settings → AI Brain.";
  }
  return "The internet works but no provider answered — read the per-provider reasons below; they are exact.";
}

export const SUGGESTION_COPY = {
  noKey: "Paste a free key in Settings → AI Brain (Groq takes 30 seconds).",
  auth: "The key was rejected — re-paste it from the provider's dashboard (copy the WHOLE key).",
  "rate-limit": "Free-tier limit hit — wait a minute, or turn on more providers so the chain has room.",
  network: "This provider is unreachable from your machine — often a VPN/AV block; check the Doctor's network row.",
  timeout: "The provider was too slow — the chain will fail over to the next one automatically.",
  http: "The provider refused the request — see the message; a dead model id is auto-replaced within a minute.",
  parked: "This provider failed repeatedly and is resting for a bit — it will rejoin automatically.",
  envConflict: "Two DIFFERENT keys were found for the same provider in your .env files — the Settings key now always wins (restart to be safe).",
};
