// Quip V2 — .env store (pure helpers, no Electron imports).
// ─────────────────────────────────────────────────────────────────────────────
// The Settings panel lets the user paste an API key in-app. This module
// persists it to the userData/.env file that main.ts already loads at boot,
// and validates key formats so typos never reach the provider.
// Pure Node so it can be regression-tested without Electron.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";

export type ProviderId = "openrouter" | "groq";

export const PROVIDER_KEY_VAR: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
};

export const PROVIDER_MODEL_VAR: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_MODEL",
  groq: "GROQ_MODEL",
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openrouter: "minimax/minimax-m3:free",
  groq: "llama-3.3-70b-versatile",
};

export interface KeyValidation {
  ok: boolean;
  message: string;
}

/** Validate an API key's shape. Honest — we only check obvious formats. */
export function validateApiKey(provider: ProviderId, apiKey: string): KeyValidation {
  const key = (apiKey ?? "").trim();
  if (!key) return { ok: false, message: "The key is empty — paste your API key first." };
  if (/\s/.test(key)) return { ok: false, message: "API keys can't contain spaces — re-copy the whole key." };
  if (provider === "openrouter" && !key.startsWith("sk-or-")) {
    return { ok: false, message: "OpenRouter keys start with \"sk-or-\". That doesn't look like an OpenRouter key." };
  }
  if (provider === "groq" && !key.startsWith("gsk_")) {
    return { ok: false, message: "Groq keys start with \"gsk_\". That doesn't look like a Groq key." };
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
