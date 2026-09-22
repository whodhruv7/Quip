// Quip Action Engine — Recovery (spec §15 + §16 + §17)
// ─────────────────────────────────────────────────────────────────────────────
// Failures are classified, never ignored:
//
//   timeout          → retry ONCE if the action is idempotent, else give up
//   cancelled        → stop immediately, no recovery theater
//   permission       → declined is FINAL (never re-asks, never sneaks past)
//   not-found        → re-observe once (maybe the world changed), then stop
//   transient        → one backoff retry for idempotent actions
//   fatal/other      → stop with the honest reason
//
// Every give-up carries the reason the user will see. A recovered step is
// re-verified by the executor's own verification — "retried" never counts
// as "done" (§14).
// ─────────────────────────────────────────────────────────────────────────────

export type FailureKind =
  | "timeout"
  | "cancelled"
  | "permission"
  | "not-found"
  | "transient"
  | "smtp-auth"
  | "smtp-rejected"
  | "ghost-blocked"
  | "vault-locked"
  | "watch-stopped"
  | "fatal";

export type RecoveryStrategy = "retry" | "reobserve" | "give-up";

export interface RecoveryDecision {
  strategy: RecoveryStrategy;
  /** How long to wait before the retry (0 for reobserve). */
  backoffMs: number;
  reason: string;
}

const BASE_BACKOFF_MS = 700;

/** Deterministic failure classification from a tool result + engine context. */
export function classifyFailure(input: {
  note: string;
  timedOut: boolean;
  cancelled: boolean;
  declined?: boolean;
}): FailureKind {
  if (input.cancelled) return "cancelled";
  if (input.declined) return "permission";
  if (input.timedOut) return "timeout";

  const note = (input.note ?? "").toLowerCase();
  if (
    /declin|denied|permission|not approved|approve/.test(note) ||
    /cancelled by the user|stopped/.test(note)
  ) {
    return "permission";
  }
  // ── CAP-075: the autonomy wave's new failure modes, first-class ──
  if (/smtp.*(auth|login|authentication)|535|530|auth failed|bad credentials/.test(note)) return "smtp-auth";
  if (/\b5\d\d\b|550|551|552|553|554|mailbox unavailable|rejected by the server/.test(note)) return "smtp-rejected";
  if (/site (ne )?blocked|captcha|cloudflare|access forbidden|bot detection|403 forbidden/.test(note)) return "ghost-blocked";
  if (/vault|could not be decrypted|safeStorage|re-enter (your )?password/.test(note)) return "vault-locked";
  if (/watch (stopped|died)|fs\.watch|watcher/.test(note)) return "watch-stopped";
  if (
    /couldn'?t find|no matching|not found|doesn'?t exist|no results|no confident|empty|not installed/.test(
      note
    )
  ) {
    return "not-found";
  }
  if (
    /timed out|too long|network|unreachable|fetch failed|rate.?limit|429|econn|enotfound|temporarily/.test(
      note
    )
  ) {
    return "transient";
  }
  return "fatal";
}

/** What the engine does after a failure — deterministic, bounded. */
export function decideRecovery(input: {
  kind: FailureKind;
  attempt: number;
  retryable: boolean;
}): RecoveryDecision {
  switch (input.kind) {
    case "cancelled":
      return { strategy: "give-up", backoffMs: 0, reason: "You stopped the task." };

    case "permission":
      return {
        strategy: "give-up",
        backoffMs: 0,
        reason: "The action was not approved, so I didn't run it.",
      };

    case "timeout":
      if (input.retryable && input.attempt < 2) {
        return {
          strategy: "retry",
          backoffMs: BASE_BACKOFF_MS * input.attempt,
          reason: "The step took too long — retrying once.",
        };
      }
      return {
        strategy: "give-up",
        backoffMs: 0,
        reason: "The step kept timing out, so I stopped waiting.",
      };

    case "not-found":
      // One re-observe: give the world one chance to have changed
      // (slow app launch, delayed window title) — never a blind repeat.
      if (input.attempt < 2) {
        return {
          strategy: "reobserve",
          backoffMs: 400,
          reason: "I'll look once more before accepting it's not there.",
        };
      }
      return {
        strategy: "give-up",
        backoffMs: 0,
        reason: "It's genuinely not there — I won't pretend otherwise.",
      };

    case "transient":
      if (input.retryable && input.attempt < 2) {
        return {
          strategy: "retry",
          backoffMs: BASE_BACKOFF_MS * input.attempt,
          reason: "That looked temporary — one retry.",
        };
      }
      return {
        strategy: "give-up",
        backoffMs: 0,
        reason: "It kept failing the same way, so I stopped.",
      };

    // ── CAP-076: recovery decisions for the new failure modes ──
    case "smtp-auth":
      // Wrong credentials NEVER fix themselves — one retry can't help.
      return {
        strategy: "give-up",
        backoffMs: 0,
        reason: "The mail server rejected the login — the password needs re-entering in Settings → MailWing.",
      };

    case "smtp-rejected":
      // The server's 5xx word is final (spec: never argue with the MX).
      return {
        strategy: "give-up",
        backoffMs: 0,
        reason: "The mail server refused this message — I won't retry what it already rejected.",
      };

    case "ghost-blocked":
      return {
        strategy: "give-up",
        backoffMs: 0,
        reason: "The site blocked the ghost browser (bot protection). I report it honestly instead of fighting the site.",
      };

    case "vault-locked":
      return {
        strategy: "give-up",
        backoffMs: 0,
        reason: "The stored secret can't be decrypted on this machine — re-enter it once and everything works again.",
      };

    case "watch-stopped":
      return {
        strategy: "reobserve",
        backoffMs: 1_000,
        reason: "The folder watch stopped — I'll check its state once more.",
      };

    case "fatal":
    default:
      return {
        strategy: "give-up",
        backoffMs: 0,
        reason: "That failed in a way retrying would not fix.",
      };
  }
}

/** User-facing failure line — honest, specific, no blame-shifting. */
export function failureLine(stepDesc: string, kind: FailureKind, reason: string): string {
  return `${stepDesc}: failed (${kind}) — ${reason}`;
}
