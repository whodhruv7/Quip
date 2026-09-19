// Quip V3.1 — connection journal (pure ring buffer, injectable persistence).
// ─────────────────────────────────────────────────────────────────────────────
// Every real provider attempt (success or failure) lands here with its
// latency and honest reason — never the key. The Doctor screen reads the
// tail so "why can't I connect" shows EVIDENCE ("last 10 attempts: Groq 401
// ×6, Cerebras 429 ×3, Gemini answered") instead of a guess.
// Persistence is injected by main.ts (userData/quip-connections.json,
// debounced) so this module stays fs-free and regression-testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface JournalEntry {
  ts: number;
  provider: string;
  model: string;
  ok: boolean;
  kind: string;
  latencyMs: number;
  note: string;
  /** True when this attempt was an automatic failover switch. */
  switched?: boolean;
}

export const JOURNAL_MAX = 80;

export class ConnectionJournal {
  private entries: JournalEntry[] = [];
  private persist: ((entries: JournalEntry[]) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** main.ts wires this to a debounced JSON file write. */
  configurePersist(persist: (entries: JournalEntry[]) => void): void {
    this.persist = persist;
  }

  /** Restore from disk at boot. */
  load(entries: JournalEntry[]): void {
    if (!Array.isArray(entries)) return;
    this.entries = entries
      .filter((e) => e && typeof e.provider === "string")
      .slice(-JOURNAL_MAX);
  }

  record(entry: Omit<JournalEntry, "ts"> & { ts?: number }): void {
    this.entries.push({
      ts: entry.ts ?? this.now(),
      provider: String(entry.provider ?? "?").slice(0, 40),
      model: String(entry.model ?? "").slice(0, 80),
      ok: entry.ok === true,
      kind: String(entry.kind ?? "").slice(0, 24),
      latencyMs: Number(entry.latencyMs ?? 0) || 0,
      note: String(entry.note ?? "").slice(0, 200),
      switched: entry.switched,
    });
    if (this.entries.length > JOURNAL_MAX) {
      this.entries = this.entries.slice(-JOURNAL_MAX);
    }
    this.schedulePersist();
  }

  tail(n: number): JournalEntry[] {
    return this.entries.slice(-Math.max(0, n));
  }

  all(): JournalEntry[] {
    return this.entries.slice();
  }

  clear(): void {
    this.entries = [];
    this.schedulePersist();
  }

  private schedulePersist(): void {
    const persist = this.persist;
    if (!persist) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        persist(this.all());
      } catch {
        /* best effort — the journal must never break the app */
      }
    }, 1500);
  }
}

/** Singleton used by the model router. */
export const connectionJournal = new ConnectionJournal();

/** Plain-language summary of the last N attempts for the Doctor UI. */
export function summarizeJournal(entries: JournalEntry[], n = 10): string {
  const tail = entries.slice(-n);
  if (tail.length === 0) return "No connection attempts recorded yet.";
  const lines = tail.map((e) => {
    const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const mark = e.ok ? "✓" : "✗";
    const note = e.note ? ` — ${e.note}` : "";
    const switchNote = e.switched ? " (failover)" : "";
    return `${mark} ${time} · ${e.provider} (${Math.round(e.latencyMs)}ms)${switchNote}${note}`;
  });
  return lines.join("\n");
}
