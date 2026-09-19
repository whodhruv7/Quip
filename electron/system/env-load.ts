// Quip V3.1 — .env parsing + precedence (pure, dependency-free).
// ─────────────────────────────────────────────────────────────────────────────
// THE BUG THIS FIXES: main.ts used to load files in order (repo → appPath →
// userData) with FIRST-FILE-WINS (`if (!process.env[key])`). run-quip.cmd
// starts the app from the repo folder, so a stale/placeholder key sitting in
// the repo .env PERMANENTLY masked the key the user pasted in Settings
// (which lives in userData/.env). Result: "Test connection" passed (it tests
// the pasted key) while chat kept using the dead old key — the exact
// "same problem again and again" loop.
//
// NEW PRECEDENCE (the fix):
//   1. OS environment variables win over repo files (repo files only FILL
//      missing keys — they can never override the real environment).
//   2. The Settings-managed userData/.env wins over EVERYTHING — it is the
//      app's source of truth (the user pasted those keys in-app).
//   3. Empty values and template placeholders NEVER occupy a slot — a
//      "your-groq-key-here" line can no longer block a real key.
// ─────────────────────────────────────────────────────────────────────────────

/** Template junk that must never count as a real key. */
const PLACEHOLDER_VALUES = new Set([
  "your-groq-key-here",
  "your-openrouter-key-here",
  "your-cerebras-key-here",
  "your-nvidia-key-here",
  "your-gemini-key-here",
  "your-key-here",
  "your-api-key-here",
  "nvapi-your-key-here",
  "sk-or-v1-your-key-here",
  "changeme",
  "change-me",
  "paste-key-here",
  "xxx",
]);

export function isPlaceholderValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.length === 0 || PLACEHOLDER_VALUES.has(v);
}

/** Parse one .env text into ordered [key, value] pairs (comments/quotes handled). */
export function parseEnvFileText(txt: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const rawLine of String(txt ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    pairs.push([key, val]);
  }
  return pairs;
}

export interface EnvApplyResult {
  /** Keys newly filled in (were missing before). */
  filled: string[];
  /** Keys REPLACED because override mode was on. */
  overridden: string[];
  /** Placeholder/empty values skipped — they can never block a real key. */
  skipped: string[];
}

/**
 * Apply one .env text onto a target record (usually process.env).
 *
 * @param override false (repo files): only fill keys that are missing or
 *                 occupied by placeholders. true (Settings' userData file):
 *                 additionally REPLACE real values — the user's newest
 *                 in-app save is the source of truth.
 */
export function applyEnvText(
  target: Record<string, string | undefined>,
  txt: string,
  override = false
): EnvApplyResult {
  const result: EnvApplyResult = { filled: [], overridden: [], skipped: [] };
  for (const [key, val] of parseEnvFileText(txt)) {
    if (isPlaceholderValue(val)) {
      // A placeholder never takes a slot — but if it currently OCCUPIES one
      // (loaded earlier by the old buggy loader), clear it so a real key
      // from a later file can land.
      if (target[key] !== undefined && isPlaceholderValue(target[key] ?? "")) {
        delete target[key];
      }
      result.skipped.push(key);
      continue;
    }
    const current = target[key];
    const currentIsPlaceholder = current !== undefined && isPlaceholderValue(current);
    if (current === undefined || current === "" || currentIsPlaceholder) {
      target[key] = val;
      result.filled.push(key);
    } else if (override) {
      target[key] = val;
      result.overridden.push(key);
    }
    // else: keep the existing value (non-override mode).
  }
  return result;
}

/** Detect whether two env files carry DIFFERENT values for the same keys —
 *  the exact conflict that silently broke the app before. Used by the
 *  Doctor report (honest diagnostics, keys never included). */
export function findEnvConflicts(
  files: Array<{ name: string; txt: string }>
): Array<{ key: string; files: string[] }> {
  const owners = new Map<string, Set<string>>();
  const values = new Map<string, string>();
  for (const f of files) {
    for (const [key, val] of parseEnvFileText(f.txt)) {
      if (isPlaceholderValue(val)) continue;
      if (!values.has(key)) {
        values.set(key, val);
        owners.set(key, new Set([f.name]));
      } else if (values.get(key) !== val) {
        owners.get(key)!.add(f.name);
      }
    }
  }
  return [...owners.entries()]
    .filter(([key, set]) => set.size > 1)
    .map(([key, set]) => ({ key, files: [...set] }));
}
