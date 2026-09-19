
export type ModelProvider = "groq" | "openrouter" | "cerebras" | "nvidia" | "gemini" | "ollama" | "local";

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  label: string;
  available: boolean;
}

export interface ModelRouterStatus {
  primary: ModelConfig;
  fallback: ModelConfig | null;
  active: ModelConfig;
  healthy: boolean;
  /** Every enabled provider in failover order (primary first). */
  chain: ModelConfig[];
}

// ─── Brain health / Doctor (V3.1 connectivity round) ─────────────────────

export interface ProviderHealthRow {
  provider: string;
  label: string;
  configured: boolean;
  enabled: boolean;
  /** Milliseconds this provider is circuit-breaker parked (0 = live). */
  parkedForMs: number;
  ok: boolean;
  latencyMs: number;
  kind: string;
  message: string;
  model: string;
}

export interface EnvConflictRow {
  key: string;
  files: string[];
}

export interface DoctorReport {
  at: number;
  network: { ok: boolean; message: string };
  providers: ProviderHealthRow[];
  tts: { groq: string; edge: string; local: string };
  journal: Array<{ ts: number; provider: string; ok: boolean; latencyMs: number; note: string }>;
  envConflicts: EnvConflictRow[];
  verdict: string;
  suggestions: string[];
}

export interface BrainHealthReport {
  at: number;
  /** Cached quick health: at least one provider actually answered. */
  healthy: boolean;
  /** Provider id that answered (for the top-bar tooltip). */
  activeProvider: string | null;
  providers: ProviderHealthRow[];
}
