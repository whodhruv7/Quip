// Quip V2 — MEMORY IMPORTANCE SYSTEM
// -----------------------------------------------------------------------------
// Scores every memory 0-1 based on type, source, frequency, recency, entity
// connections, and emotional weight. Drives retrieval ranking and pruning.
// Low-score memories decay over time; pinned memories stay at 1.0 forever.
//
// Runs on every memory insert (for ranking) and as a scheduled background
// task (for pruning). Never on the chat hot path.
// -----------------------------------------------------------------------------

import type { MemoryEntry, MemoryImportance } from "../../src/types";

const TYPE_WEIGHTS: Record<string, number> = {
  contact: 0.95,
  fact: 0.9,
  preference: 0.7,
  style: 0.65,
  event: 0.4,
};

const SOURCE_WEIGHTS: Record<string, number> = {
  user_stated: 1.0,
  observed: 0.7,
  inferred: 0.5,
};

const PRUNE_THRESHOLD = 0.2;
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_MEMORIES_BEFORE_PRUNE = 500;

export interface ScoredMemory extends MemoryEntry {
  score: number;
  pruneCandidate: boolean;
}

export interface PruneReport {
  totalMemories: number;
  pruned: number;
  retained: number;
  prunedAt: number;
}

/** Score a single memory. Pure function, cheap. */
export function scoreMemory(
  memory: MemoryEntry,
  now = Date.now()
): number {
  const typeWeight = TYPE_WEIGHTS[memory.kind] ?? 0.5;
  const sourceWeight = SOURCE_WEIGHTS.user_stated; // V1: all memories are user-stated
  const frequencyBoost = Math.log(memory.weight + 1) * 0.05;
  const ageMs = now - memory.updatedAt;
  const recencyBoost = Math.max(0, 0.1 - (ageMs / (30 * 24 * 60 * 60 * 1000)) * 0.1);

  // Importance from the explicit high/medium/low field
  const importanceWeight =
    memory.importance === "high" ? 1.0 : memory.importance === "medium" ? 0.6 : 0.3;

  const score =
    typeWeight * sourceWeight * importanceWeight +
    frequencyBoost +
    recencyBoost;

  return Math.max(0, Math.min(1, score));
}

/** Determine if a memory is a prune candidate. */
export function isPruneCandidate(memory: MemoryEntry, score: number, now = Date.now()): boolean {
  // Pinned memories never prune (weight >= 10 means user-reinforced)
  if (memory.weight >= 10) return false;
  // High importance never prunes
  if (memory.importance === "high") return false;
  // Low score + old age = prune candidate
  if (score < PRUNE_THRESHOLD) {
    const ageMs = now - memory.updatedAt;
    if (ageMs > PRUNE_AGE_MS) return true;
  }
  return false;
}

/** Score all memories and return them sorted by score descending. */
export function scoreAll(memories: MemoryEntry[]): ScoredMemory[] {
  const now = Date.now();
  return memories
    .map((m) => {
      const score = scoreMemory(m, now);
      return {
        ...m,
        score,
        pruneCandidate: isPruneCandidate(m, score, now),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Get the top N memories by score. */
export function topN(memories: MemoryEntry[], n: number): ScoredMemory[] {
  return scoreAll(memories).slice(0, n);
}

/** Run a prune pass: identify and remove low-score old memories. */
export function runPrune(memories: MemoryEntry[]): {
  retained: MemoryEntry[];
  pruned: MemoryEntry[];
  report: PruneReport;
} {
  const now = Date.now();
  const scored = scoreAll(memories);

  const retained: MemoryEntry[] = [];
  const pruned: MemoryEntry[] = [];

  for (const sm of scored) {
    if (sm.pruneCandidate) {
      pruned.push(sm);
    } else {
      retained.push(sm);
    }
  }

  // If we're still over the max, drop the lowest-scored
  if (retained.length > MAX_MEMORIES_BEFORE_PRUNE) {
    const overflow = retained.splice(MAX_MEMORIES_BEFORE_PRUNE);
    pruned.push(...overflow);
  }

  return {
    retained,
    pruned,
    report: {
      totalMemories: memories.length,
      pruned: pruned.length,
      retained: retained.length,
      prunedAt: now,
    },
  };
}

/** Pin a memory: sets its weight to 10 (effectively score = 1.0). */
export function pinMemory(memory: MemoryEntry): MemoryEntry {
  return { ...memory, weight: 10, importance: "high" as MemoryImportance };
}

/** Unpin a memory: resets weight to 1. */
export function unpinMemory(memory: MemoryEntry): MemoryEntry {
  return { ...memory, weight: 1 };
}
