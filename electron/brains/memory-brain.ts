// Quip V2 — MEMORY BRAIN
// -----------------------------------------------------------------------------
// Quip should remember what matters and forget what doesn't. This brain
// stores small, weighted facts about the user and their world:
//
//   - contacts  ("CEO = Rajesh Gupta")
//   - style     ("prefers short replies, uses Hindi casually")
//   - preference("default music app = Spotify")
//   - fact      ("birthday = July 14")
//
// Each memory has an importance weight (high/medium/low) and a reinforcement
// counter. Low-importance memories decay; high ones persist forever. This
// prevents the "remembered I ate pizza once" pollution problem.
//
// The style digest is a compressed summary injected into the system prompt
// so the model talks like the user without re-reading every old message.
// -----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import type {
  MemoryEntry,
  MemoryImportance,
  UserKnowledge,
} from "../../src/types";

const FILENAME = "memory.json";
const SCHEMA_VERSION = 1;
const MAX_MEMORIES = 200;

const uid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

class MemoryBrain {
  private knowledge: UserKnowledge = {
    schemaVersion: SCHEMA_VERSION,
    memories: [],
    styleDigest: "",
    updatedAt: 0,
  };
  private filePath: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly SAVE_DEBOUNCE_MS = 2000;

  init(userDataDir: string): void {
    this.filePath = path.join(userDataDir, FILENAME);
    this.load();
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        if (data && Array.isArray(data.memories)) {
          this.knowledge = data as UserKnowledge;
        }
      }
    } catch {
      /* start fresh */
    }
  }

  /**
   * Debounced save — batches writes every 2s instead of on every change.
   * This prevents disk thrashing during rapid memory additions (e.g., during
   * extraction). The final write always happens, just not synchronously.
   */
  private save(): void {
    if (!this.filePath) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (!this.filePath) return;
      try {
        this.knowledge.updatedAt = Date.now();
        fs.writeFileSync(this.filePath, JSON.stringify(this.knowledge, null, 2));
      } catch {
        /* best effort */
      }
      this.saveTimer = null;
    }, this.SAVE_DEBOUNCE_MS);
  }

  /** Force immediate save (used on app quit). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      try {
        this.knowledge.updatedAt = Date.now();
        if (this.filePath) {
          fs.writeFileSync(this.filePath, JSON.stringify(this.knowledge, null, 2));
        }
      } catch {
        /* best effort */
      }
    }
  }

  get(): UserKnowledge {
    return { ...this.knowledge };
  }

  add(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt" | "weight">): MemoryEntry {
    // De-dup: if a memory with the same key+kind exists, reinforce it.
    const existing = this.knowledge.memories.find(
      (m) => m.kind === entry.kind && m.key.toLowerCase() === entry.key.toLowerCase()
    );
    if (existing) {
      existing.value = entry.value;
      existing.importance = entry.importance;
      existing.weight += 1;
      existing.updatedAt = Date.now();
      this.rebuildDigest();
      this.save();
      return existing;
    }

    const now = Date.now();
    const full: MemoryEntry = {
      ...entry,
      id: uid(),
      createdAt: now,
      updatedAt: now,
      weight: 1,
    };
    this.knowledge.memories.push(full);

    // Trim: drop oldest low-importance memories first if over cap.
    if (this.knowledge.memories.length > MAX_MEMORIES) {
      this.knowledge.memories.sort((a, b) => weightScore(b) - weightScore(a));
      this.knowledge.memories = this.knowledge.memories.slice(0, MAX_MEMORIES);
    }

    this.rebuildDigest();
    this.save();
    return full;
  }

  forget(id: string): void {
    this.knowledge.memories = this.knowledge.memories.filter((m) => m.id !== id);
    this.rebuildDigest();
    this.save();
  }

  /** Pin a memory so it never decays. Sets weight high + importance high. */
  pin(id: string): void {
    const m = this.knowledge.memories.find((e) => e.id === id);
    if (m) {
      m.weight = 10;
      m.importance = "high";
      m.updatedAt = Date.now();
      this.rebuildDigest();
      this.save();
    }
  }

  /** Unpin a memory — resets weight to 1 but keeps importance. */
  unpin(id: string): void {
    const m = this.knowledge.memories.find((e) => e.id === id);
    if (m) {
      m.weight = 1;
      m.updatedAt = Date.now();
      this.rebuildDigest();
      this.save();
    }
  }

  /** Bulk-replace memories (used by the prune operation). */
  replaceAll(memories: MemoryEntry[]): void {
    this.knowledge.memories = memories;
    this.rebuildDigest();
    this.save();
  }

  /** Compressed prompt summary of what we know about the user. */
  private rebuildDigest(): void {
    const m = this.knowledge.memories;
    if (m.length === 0) {
      this.knowledge.styleDigest = "";
      this.knowledge.updatedAt = Date.now();
      return;
    }
    // Prefer high-importance memories in the digest.
    const ordered = [...m].sort((a, b) => weightScore(b) - weightScore(a));
    const lines = ordered.slice(0, 12).map((mem) => {
      const tag = mem.kind === "contact" ? `${mem.key} = ${mem.value}`
        : mem.kind === "preference" ? `prefers ${mem.value}`
        : `${mem.key}: ${mem.value}`;
      return `  - ${tag}`;
    });
    this.knowledge.styleDigest =
      `What you know about the user:\n` + lines.join("\n");
    this.knowledge.updatedAt = Date.now();
  }

  /** Decay pass — drop old low-importance memories that were never reinforced. */
  decay(): void {
    const now = Date.now();
    const AGE_30D = 30 * 24 * 60 * 60 * 1000;
    this.knowledge.memories = this.knowledge.memories.filter((m) => {
      if (m.importance === "high") return true;
      const age = now - m.updatedAt;
      // low importance: forget after 30 days if not reinforced.
      if (m.importance === "low" && age > AGE_30D && m.weight < 2) return false;
      return true;
    });
    this.save();
  }
}

function weightScore(m: MemoryEntry): number {
  const base = m.importance === "high" ? 1000 : m.importance === "medium" ? 100 : 10;
  return base + m.weight * 10;
}

export const memoryBrain = new MemoryBrain();
