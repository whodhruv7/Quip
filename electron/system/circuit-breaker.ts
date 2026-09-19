// Quip V3.1 — provider circuit breaker (pure, injectable clock).
// ─────────────────────────────────────────────────────────────────────────────
// THE PROBLEM: a dead provider used to be re-dialed on EVERY message — the
// first 5-30 seconds of each reply were burned on a provider that already
// failed 5 times in a row. THE FIX: after repeated failures the provider is
// "parked" (skipped by the chain) for a short, growing window, while the
// other providers answer instantly. Parks expire automatically; when EVERY
// provider is parked the router clears all parks (a new user message must
// always get a real chance) — see ModelRouter.chain().
//
// 429 + Retry-After: when the provider itself says "come back in N seconds",
// that instruction is respected immediately — even on the FIRST failure.
// ─────────────────────────────────────────────────────────────────────────────

export const BREAKER_BASE_MS = 30_000; // first park: 30s
export const BREAKER_MAX_MS = 10 * 60_000; // never park longer than 10min
/** Park only from this many consecutive failures (1st failure = no park). */
export const BREAKER_PARK_AFTER = 2;

export function backoffMs(failures: number, base = BREAKER_BASE_MS, max = BREAKER_MAX_MS): number {
  const over = Math.max(0, failures - BREAKER_PARK_AFTER);
  return Math.min(base * Math.pow(2, over), max);
}

export interface BreakerEntry {
  failures: number;
  parkedUntil: number;
  lastError: string;
  lastFailureAt: number;
}

export class CircuitBreaker {
  private state = new Map<string, BreakerEntry>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  isAvailable(id: string): boolean {
    const e = this.state.get(id);
    if (!e) return true;
    return this.now() >= e.parkedUntil;
  }

  failures(id: string): number {
    return this.state.get(id)?.failures ?? 0;
  }

  parkedForMs(id: string): number {
    const e = this.state.get(id);
    if (!e || e.parkedUntil === 0) return 0;
    return Math.max(0, e.parkedUntil - this.now());
  }

  recordSuccess(id: string): void {
    this.state.delete(id);
  }

  /** Record a failure. `retryAfterMs` (from a 429 Retry-After) parks the
   *  provider immediately; otherwise parking starts on the 2nd consecutive
   *  failure with exponential backoff. */
  recordFailure(id: string, opts?: { retryAfterMs?: number | null; lastError?: string }): void {
    const prev = this.state.get(id) ?? { failures: 0, parkedUntil: 0, lastError: "", lastFailureAt: 0 };
    const failures = prev.failures + 1;
    let park = 0;
    if (opts?.retryAfterMs && opts.retryAfterMs > 0) {
      park = Math.min(opts.retryAfterMs, BREAKER_MAX_MS);
    } else if (failures >= BREAKER_PARK_AFTER) {
      park = backoffMs(failures);
    }
    this.state.set(id, {
      failures,
      parkedUntil: park > 0 ? this.now() + park : 0,
      lastError: String(opts?.lastError ?? prev.lastError ?? "").slice(0, 160),
      lastFailureAt: this.now(),
    });
  }

  reset(id: string): void {
    this.state.delete(id);
  }

  resetAll(): void {
    this.state.clear();
  }

  snapshot(): Record<string, { failures: number; parkedForMs: number; lastError: string }> {
    const out: Record<string, { failures: number; parkedForMs: number; lastError: string }> = {};
    for (const [id, e] of this.state) {
      out[id] = { failures: e.failures, parkedForMs: this.parkedForMs(id), lastError: e.lastError };
    }
    return out;
  }
}

/** Parse a Retry-After header (seconds or HTTP-date) → ms from now. */
export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const h = String(header).trim();
  if (!h) return null;
  if (/^\d+$/.test(h)) {
    const secs = parseInt(h, 10);
    return secs > 0 && secs <= 3600 ? secs * 1000 : null;
  }
  const date = Date.parse(h);
  if (Number.isNaN(date)) return null;
  const ms = date - now;
  return ms > 0 && ms <= 3600_000 ? ms : null;
}
