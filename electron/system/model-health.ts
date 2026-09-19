// Quip V3.1 — model auto-health (pure decision, injectable probe).
// ─────────────────────────────────────────────────────────────────────────────
// THE PROBLEM: providers RETIRE model ids (Groq killed llama-3.3-70b-versatile
// for free tiers on 2026-08-16; NVIDIA removed meta/llama-3.3-70b-instruct).
// A configured dead id fails EVERY chat until a human notices.
// THE FIX: at boot (and weekly), the configured model gets a real 1-token
// probe. If the provider rejects the MODEL (not the key), the spares are
// probed in order and the first live one is auto-saved — Quip heals itself
// instead of waiting for a user report.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProbeLike {
  ok: boolean;
  message: string;
}

/** Model-rejection detection on PROBE messages (mirrors the router's own
 *  detector — providers word rejections differently, so stay broad). */
export function looksLikeModelRejection(probe: ProbeLike): boolean {
  if (probe.ok) return false;
  const m = probe.message.toLowerCase();
  return (
    m.includes("model") &&
    /(not found|not exist|does not exist|no longer|decommission|deprecat|invalid|unknown|unsupported|retired|not available|not supported|was rejected)/.test(m)
  );
}

export interface MigrationDecision {
  migrated: boolean;
  /** The new model id when migrated. */
  model?: string;
  reason: string;
}

/**
 * Probe the configured model; when it is rejected, probe each spare and
 * return the first live one. Never throws — a probe crash is an honest
 * "couldn't verify" so the caller keeps the current model.
 */
export async function autoMigrateModel(opts: {
  configured: string;
  spares: string[];
  probe: (model: string) => Promise<ProbeLike>;
}): Promise<MigrationDecision> {
  const { configured, spares, probe } = opts;
  try {
    const probeConfigured = await probe(configured);
    if (probeConfigured.ok) {
      return { migrated: false, reason: `ok — ${configured} answers` };
    }
    if (!looksLikeModelRejection(probeConfigured)) {
      // Key/auth/network problems are NOT model problems — do not migrate.
      return { migrated: false, reason: probeConfigured.message };
    }
  } catch (e: any) {
    return { migrated: false, reason: `probe failed: ${String(e?.message ?? e).slice(0, 120)}` };
  }

  for (const spare of spares) {
    if (spare === configured) continue;
    try {
      const r = await probe(spare);
      if (r.ok) {
        return { migrated: true, model: spare, reason: `${configured} was rejected by the provider — switched to ${spare}` };
      }
    } catch {
      /* try the next spare */
    }
  }
  return { migrated: false, reason: `${configured} was rejected but no spare model answered either` };
}
