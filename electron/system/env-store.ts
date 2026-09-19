// Quip V3 — .env store (pure helpers, no Electron imports).
// ─────────────────────────────────────────────────────────────────────────────
// The Settings panel lets the user paste API keys in-app. This module
// persists them to the userData/.env file that main.ts already loads at boot,
// and validates key formats so typos never reach the provider.
// SIX providers, all OpenAI-compatible:
//   groq · gemini · cerebras · nvidia · openrouter · ollama(local backup)
// Gemini uses Google's official OpenAI-compatible endpoint (free tier = the
// largest daily quota of any provider here). Ollama is the OFFLINE last
// resort — no key, runs on the laptop itself, OFF by default.
// Pure Node so it can be regression-tested without Electron.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";

export type ProviderId = "openrouter" | "groq" | "cerebras" | "nvidia" | "gemini" | "ollama";

/** Canonical priority order when the user has not chosen a primary.
 *  Groq stays FIRST (the user's Groq key is THE key); Gemini is second — its
 *  free daily quota is the largest, so the failover chain gets real depth;
 *  Ollama sits LAST as the offline last resort. */
export const PROVIDER_ORDER: ProviderId[] = ["groq", "gemini", "cerebras", "nvidia", "openrouter", "ollama"];

/** Typed as Record<string, string> because ModelProvider also includes the
 *  "local" identity — indexing must stay safe for every caller. */
export const PROVIDER_LABEL: Record<string, string> = {
  groq: "Groq",
  gemini: "Gemini",
  cerebras: "Cerebras",
  nvidia: "NVIDIA",
  openrouter: "OpenRouter",
  ollama: "Ollama (local backup)",
};

export const PROVIDER_KEY_VAR: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  gemini: "GEMINI_API_KEY",
  // Ollama needs NO key — the var name is unused (guarded by callers).
  ollama: "OLLAMA_UNUSED_NO_KEY",
};

export const PROVIDER_MODEL_VAR: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_MODEL",
  groq: "GROQ_MODEL",
  cerebras: "CEREBRAS_MODEL",
  nvidia: "NVIDIA_MODEL",
  gemini: "GEMINI_MODEL",
  ollama: "QUIP_OLLAMA_MODEL",
};

// Defaults verified live on 2026-09-13 (OpenRouter re-verified 2026-09-19):
//  - Groq decommissioned llama-3.3-70b-versatile + llama-3.1-8b-instant for
//    Free/Developer tiers on 2026-08-16 → their recommended replacement is
//    GPT-OSS (120B flagship / 20B fast).
//  - NVIDIA NIM no longer lists meta/llama-3.3-70b-instruct → openai/gpt-oss-20b
//    is verified present in the live /v1/models list.
//  - OpenRouter: minimax/minimax-m3:free does NOT exist (only the paid id);
//    google/gemma-4-31b-it:free + nvidia/nemotron-3-super-120b-a12b:free are
//    verified in the LIVE free list (22 free models as of 2026-09-19).
//  - Cerebras documents llama-3.3-70b as supported (changelog verified).
//  - Gemini: 2.0 Flash retired mid-2026 → 2.5 Flash is the safe default and
//    the model auto-health check migrates off any retired id within a minute
//    of a boot probe (model-health.ts).
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openrouter: "google/gemma-4-31b-it:free",
  groq: "openai/gpt-oss-120b",
  cerebras: "llama-3.3-70b",
  nvidia: "openai/gpt-oss-20b",
  gemini: "gemini-2.5-flash",
  ollama: "llama3.2:3b",
};

/** Verified-live spare model ids per provider. When a provider rejects the
 *  configured id (decommissioned / renamed — this EXACTLY broke the old Groq
 *  default), the router silently retries the next candidate on the SAME
 *  provider before failing over to the next provider. */
export const FALLBACK_MODELS: Record<ProviderId, string[]> = {
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "meta-llama/llama-4-scout-17b-16e-instruct"],
  cerebras: ["llama-3.3-70b", "gpt-oss-120b"],
  nvidia: ["openai/gpt-oss-20b", "nvidia/llama-3.1-nemotron-70b-instruct", "moonshotai/kimi-k2.6"],
  openrouter: ["google/gemma-4-31b-it:free", "nvidia/nemotron-3-super-120b-a12b:free", "openrouter/free"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"],
  ollama: [],
};

export const PROVIDER_ENABLED_VAR: Record<ProviderId, string> = {
  openrouter: "QUIP_OPENROUTER_ENABLED",
  groq: "QUIP_GROQ_ENABLED",
  cerebras: "QUIP_CEREBRAS_ENABLED",
  nvidia: "QUIP_NVIDIA_ENABLED",
  gemini: "QUIP_GEMINI_ENABLED",
  ollama: "QUIP_OLLAMA_ENABLED",
};

/** Default on/off per provider. Ollama is the ONLY default-off provider:
 *  it needs a separate app running on the laptop, so assuming it exists
 *  would put a guaranteed-dead provider in every chain. */
export function providerEnabledByDefault(id: ProviderId): boolean {
  return id !== "ollama";
}

/** Live enabled check — Settings kill switch + the ollama default-off rule.
 *  Single source of truth used by BOTH the router and main.ts IPC. */
export function isProviderEnabled(id: ProviderId): boolean {
  const raw = process.env[PROVIDER_ENABLED_VAR[id]];
  if (id === "ollama") return raw === "1"; // opt-in only
  return raw !== "0";
}

export interface KeyValidation {
  ok: boolean;
  message: string;
}

/** The visible prefix of each provider's key — catches copy/paste mixups.
 *  Empty string = no key needed (Ollama) — validation is skipped. */
export const KEY_PREFIX: Record<ProviderId, string> = {
  openrouter: "sk-or-",
  groq: "gsk_",
  cerebras: "csk-",
  nvidia: "nvapi-",
  gemini: "AIza",
  ollama: "",
};

/** Validate an API key's shape. Honest — we only check obvious formats. */
export function validateApiKey(provider: ProviderId, apiKey: string): KeyValidation {
  const key = (apiKey ?? "").trim();
  if (!key) return { ok: false, message: "The key is empty — paste your API key first." };
  if (/\s/.test(key)) return { ok: false, message: "API keys can't contain spaces — re-copy the whole key." };
  const prefix = KEY_PREFIX[provider];
  if (prefix && !key.startsWith(prefix)) {
    return {
      ok: false,
      message: `${PROVIDER_LABEL[provider]} keys start with "${prefix}". That doesn't look like a ${PROVIDER_LABEL[provider]} key.`,
    };
  }
  return { ok: true, message: "Key format looks right." };
}

/**
 * Merge key=value entries into an env file, replacing existing vars in place
 * and preserving comments, blank lines and unrelated entries. Creates the
 * file (with a small header) when missing.
 */
export function upsertEnvFile(
  filePath: string,
  entries: Record<string, string>
): { ok: boolean; error?: string } {
  try {
    let lines: string[] = [];
    if (fs.existsSync(filePath)) {
      lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    } else {
      lines = [
        "# Quip — local environment (managed by Quip Settings)",
        "# Never commit this file or share your keys.",
      ];
    }

    for (const [key, value] of Object.entries(entries)) {
      const trimmedValue = value.trim();
      const lineRe = new RegExp(`^\\s*(export\\s+)?${key}\\s*=`);
      let replaced = false;
      lines = lines.map((line) => {
        if (!replaced && lineRe.test(line)) {
          replaced = true;
          return `${key}=${trimmedValue}`;
        }
        return line;
      });
      if (!replaced) {
        // Drop a trailing blank run before appending (keeps the file tidy).
        while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
        lines.push(`${key}=${trimmedValue}`);
      }
    }

    fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Mask a key for display: "sk-or-v1-abcd…wxyz" style, never the full value. */
export function maskKey(key: string | undefined): string {
  const k = (key ?? "").trim();
  if (!k) return "";
  if (k.length <= 10) return `${k.slice(0, 2)}…`;
  return `${k.slice(0, 9)}…${k.slice(-4)}`;
}
