// Quip V3.1 — prompt budget + history trim (pure).
// ─────────────────────────────────────────────────────────────────────────────
// THE PROBLEM: free-tier providers cap TOKENS PER MINUTE (Groq free ≈ 6k-8k
// TPM). Quip's system prompt had grown to many sections (device + world
// model + memories + entities + style + timeline + workspace + capabilities)
// and EVERY message re-sent the full history — the 2nd message within a
// minute blew the limit and produced 429s that looked like "providers never
// connect".
// THE FIX: sections are assembled by PRIORITY under a hard character budget
// (identity always survives; nice-to-have context drops first), and history
// is trimmed to the most recent messages with a hard per-message cap.
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptSection {
  id: string;
  text: string;
  /** 1 = identity (always kept) … 5 = first to drop. */
  priority: number;
}

export interface AssembleResult {
  prompt: string;
  dropped: string[];
}

const SECTION_SEPARATOR = "\n\n";

/**
 * Assemble sections under a character budget. Priority 1 sections are ALWAYS
 * included (even if the budget is absurdly small); everything else joins in
 * priority order while it still fits. Returns which sections were dropped so
 * callers can log honestly.
 */
export function assembleSections(sections: PromptSection[], budgetChars: number): AssembleResult {
  const kept: PromptSection[] = [];
  const deferred: PromptSection[] = [];
  for (const s of sections) {
    if (!s.text || !s.text.trim()) continue;
    if (s.priority === 1) kept.push(s);
    else deferred.push(s);
  }
  deferred.sort((a, b) => a.priority - b.priority);

  const dropped: string[] = [];
  let used = kept.reduce((n, s) => n + s.text.length, 0)
    + (kept.length > 0 ? (kept.length - 1) * SECTION_SEPARATOR.length : 0);

  for (const s of deferred) {
    const cost = s.text.length + (used > 0 ? SECTION_SEPARATOR.length : 0);
    if (used + cost <= budgetChars) {
      kept.push(s);
      used += cost;
    } else {
      dropped.push(s.id);
    }
  }

  // Restore prompt order: callers pass sections in display order; keep that.
  const order = new Map(sections.map((s, i) => [s.id, i]));
  kept.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return { prompt: kept.map((s) => s.text.trim()).join(SECTION_SEPARATOR), dropped };
}

export interface TrimOptions {
  maxMessages?: number;
  maxChars?: number;
  /** Any single message longer than this is truncated (system context, pasted logs). */
  perMessageCap?: number;
}

export const DEFAULT_TRIM: Required<TrimOptions> = {
  maxMessages: 14,
  maxChars: 7000,
  perMessageCap: 4000,
};

function clip(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return text.slice(0, cap) + "…";
}

/**
 * Keep the most RECENT messages within the budget. The LAST user message is
 * never dropped (it is the thing being answered). Old messages go first.
 */
export function trimHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  opts?: TrimOptions
): Array<{ role: "user" | "assistant"; content: string }> {
  const { maxMessages, maxChars, perMessageCap } = { ...DEFAULT_TRIM, ...opts };
  const rows = (history ?? [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: clip(m.content, perMessageCap) }));

  if (rows.length === 0) return rows;

  // Take from the end (most recent), then enforce the char budget from the
  // front (oldest dropped first). The final user message is always kept.
  let picked = rows.slice(-maxMessages);
  let total = picked.reduce((n, m) => n + m.content.length, 0);
  while (picked.length > 1 && total > maxChars) {
    const removed = picked.shift()!;
    total -= removed.content.length;
  }
  return picked;
}
