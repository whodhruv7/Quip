// Quip V3 — .env store (pure helpers, no Electron imports).
// ─────────────────────────────────────────────────────────────────────────────
// The Settings panel lets the user paste API keys in-app. This module
// persists them to the userData/.env file that main.ts already loads at boot,
// and validates key formats so typos never reach the provider.
// Four providers, all OpenAI-compatible:
//   groq · cerebras · nvidia · openrouter
// Pure Node so it can be regression-tested without Electron.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";

export type ProviderId = "openrouter" | "groq" | "cerebras" | "nvidia";

/** Canonical priority order when the user has not chosen a primary. */
export const PROVIDER_ORDER: ProviderId[] = ["groq", "cerebras", "nvidia", "openrouter"];

/** Typed as Record<string, string> because ModelProvider also includes the
 *  "local" identity — indexing must stay safe for every caller. */
export const PROVIDER_LABEL: Record<string, string> = {
  groq: "Groq",
  cerebras: "Cerebras",
  nvidia: "NVIDIA",
  openrouter: "OpenRouter",
};

export const PROVIDER_KEY_VAR: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  nvidia: "NVIDIA_API_KEY",
};

export const PROVIDER_MODEL_VAR: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_MODEL",
  groq: "GROQ_MODEL",
  cerebras: "CEREBRAS_MODEL",
  nvidia: "NVIDIA_MODEL",
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openrouter: "minimax/minimax-m3:free",
  groq: "llama-3.3-70b-versatile",
  cerebras: "llama-3.3-70b",
  nvidia: "meta/llama-3.3-70b-instruct",
};

export const PROVIDER_ENABLED_VAR: Record<ProviderId, string> = {
  openrouter: "QUIP_OPENROUTER_ENABLED",
  groq: "QUIP_GROQ_ENABLED",
  cerebras: "QUIP_CEREBRAS_ENABLED",
  nvidia: "QUIP_NVIDIA_ENABLED",
};

export interface KeyValidation {
  ok: boolean;
  message: string;
}

/** The visible prefix of each provider's key — catches copy/paste mixups. */
export const KEY_PREFIX: Record<ProviderId, string> = {
  openrouter: "sk-or-",
  groq: "gsk_",
  cerebras: "csk-",
  nvidia: "nvapi-",
};

/** Validate an API key's shape. Honest — we only check obvious formats. */
export function validateApiKey(provider: ProviderId, apiKey: string): KeyValidation {
  const key = (apiKey ?? "").trim();
  if (!key) return { ok: false, message: "The key is empty — paste your API key first." };
  if (/\s/.test(key)) return { ok: false, message: "API keys can't contain spaces — re-copy the whole key." };
  const prefix = KEY_PREFIX[provider];
  if (!key.startsWith(prefix)) {
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
