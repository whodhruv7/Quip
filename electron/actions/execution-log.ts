// Quip Action Engine — Structured Execution Log (spec Phase 2 observability)
// ─────────────────────────────────────────────────────────────────────────────
// EVERY action attempt — success or failure, every retry — produces one
// structured entry. No silent attempts, no lost failures:
//
//   { ts, taskId, step, action, target, safety, risk, mode, attempt,
//     durationMs, ok, summary, evidence[], failureKind? }
//
// The log is an in-memory ring (bounded), subscribable for live UI, and
// optionally persisted (debounced) to userData for post-mortems. Params are
// stored truncated — the log must never become a secret leak.
// ─────────────────────────────────────────────────────────────────────────────

export interface ActionLogEntry {
  ts: number;
  taskId: string;
  stepIndex: number;
  action: string;
  target: string;
  safety: string;
  risk: string;
  mode: string;
  attempt: number;
  durationMs: number;
  ok: boolean;
  summary: string;
  evidence: string[];
  failureKind?: string;
  /** Truncated, semicolon-joined params (observability without leakage). */
  paramsDigest: string;
}

/** What the ring stores — raw params are digested, never kept verbatim. */
export type StoredActionEntry = Omit<ActionLogEntry, "paramsDigest">;

const RING_LIMIT = 250;
const PARAM_DIGEST_MAX = 160;

function digestParams(params: Record<string, string> | undefined): string {
  if (!params) return "";
  try {
    const joined = Object.entries(params)
      .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
      .join("; ");
    return joined.slice(0, PARAM_DIGEST_MAX);
  } catch {
    return "<unprintable>";
  }
}

class ExecutionLog {
  private ring: StoredActionEntry[] = [];
  private listeners = new Set<(e: ActionLogEntry) => void>();
  private persistPath: string | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  /** Point the log at a file (userData). Call once at boot; tests skip this. */
  setPersistPath(path: string | null): void {
    this.persistPath = path;
  }

  record(
    entry: Omit<StoredActionEntry, "ts"> & { params?: Record<string, string> }
  ): ActionLogEntry {
    const ts = Date.now();
    const paramsDigest = digestParams(entry.params);
    const { params: _raw, ...rest } = entry;
    void _raw;
    const stored: StoredActionEntry = { ...rest, ts };
    this.ring.push(stored);
    if (this.ring.length > RING_LIMIT) this.ring.shift();
    const full: ActionLogEntry = { ...stored, paramsDigest };
    for (const l of this.listeners) {
      try {
        l(full);
      } catch {
        /* a listener must never break logging */
      }
    }
    this.schedulePersist();
    return full;
  }

  subscribe(fn: (e: ActionLogEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  recent(n = 40): StoredActionEntry[] {
    return this.ring.slice(-n);
  }

  /** Entries for one task — the per-task story for debugging/explanations. */
  forTask(taskId: string): StoredActionEntry[] {
    return this.ring.filter((e) => e.taskId === taskId);
  }

  /** One-line honest digest: "12 actions · 10 ok · 2 failed". */
  digest(): string {
    const ok = this.ring.filter((e) => e.ok).length;
    const total = this.ring.length;
    return `${total} action${total === 1 ? "" : "s"} · ${ok} ok · ${total - ok} failed`;
  }

  clearForTests(): void {
    this.ring = [];
  }

  private schedulePersist(): void {
    if (!this.persistPath) return;
    this.dirty = true;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (!this.dirty || !this.persistPath) return;
      this.dirty = false;
      // Lazy require keeps this module importable outside Electron.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require("fs") as typeof import("fs");
        fs.writeFile(this.persistPath, JSON.stringify(this.ring.slice(-RING_LIMIT)), () => {});
      } catch {
        /* persistence is best-effort; the in-memory log is authoritative */
      }
    }, 2000);
  }
}

export const executionLog = new ExecutionLog();
export type { ExecutionLog };
