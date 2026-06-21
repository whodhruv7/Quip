// Quip V2 — COMPANION EVOLUTION SYSTEM
// -----------------------------------------------------------------------------
// Tracks long-term progression per companion. Not XP, not levels — a "depth"
// metric based on conversations, messages, tasks, memories, and longevity.
// Unlocks cosmetic upgrades at depth milestones (tier 1/2/3). Purely cosmetic,
// purely emotional. When a new cosmetic unlocks, the companion celebrates.
//
// Storage: JSON file in userData. Updated after every interaction.
// -----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import type { CompanionId } from "../../src/types";

const FILENAME = "companion-progression.json";
const SCHEMA_VERSION = 1;

export interface CompanionProgression {
  companion: CompanionId;
  conversations: number;
  totalMessages: number;
  tasksCompleted: number;
  memoriesCreated: number;
  firstInteractionAt: number;
  daysSinceFirst: number;
  depth: number; // 0-1
  unlockedCosmetics: CosmeticUnlock[];
}

export interface CosmeticUnlock {
  id: string;
  companion: CompanionId;
  tier: 1 | 2 | 3;
  name: string;
  description: string;
  unlockedAt: number;
}

const COSMETICS: Record<CompanionId, { tier: 1 | 2 | 3; name: string; description: string; threshold: number }[]> = {
  pix: [
    { tier: 1, name: "Tiny Scarf", description: "A cozy aqua scarf", threshold: 50 },
    { tier: 2, name: "Star Sparkle", description: "A twinkling star accent", threshold: 150 },
    { tier: 3, name: "Color Shift", description: "Eyes shimmer pink-aqua", threshold: 300 },
  ],
  kai: [
    { tier: 1, name: "Leaf Accent", description: "A small green leaf pin", threshold: 50 },
    { tier: 2, name: "Book Badge", description: "A tiny book emblem", threshold: 150 },
    { tier: 3, name: "Constellation Aura", description: "A soft starry glow", threshold: 300 },
  ],
  zee: [
    { tier: 1, name: "Curiosity Spark", description: "A glowing question mark", threshold: 50 },
    { tier: 2, name: "Galaxy Trail", description: "Stardust follows behind", threshold: 150 },
    { tier: 3, name: "Cosmic Crown", description: "A miniature galaxy halo", threshold: 300 },
  ],
};

function computeDepth(p: Omit<CompanionProgression, "depth" | "unlockedCosmetics">): number {
  const conversationScore = Math.min(p.conversations / 300, 1) * 0.4;
  const messageScore = Math.min(p.totalMessages / 2000, 1) * 0.2;
  const taskScore = Math.min(p.tasksCompleted / 100, 1) * 0.2;
  const memoryScore = Math.min(p.memoriesCreated / 50, 1) * 0.1;
  const longevityScore = Math.min(p.daysSinceFirst / 90, 1) * 0.1;
  return Math.min(1, conversationScore + messageScore + taskScore + memoryScore + longevityScore);
}

function makeBaseProgression(id: CompanionId): Omit<CompanionProgression, "depth" | "unlockedCosmetics"> {
  return {
    companion: id,
    conversations: 0,
    totalMessages: 0,
    tasksCompleted: 0,
    memoriesCreated: 0,
    firstInteractionAt: 0,
    daysSinceFirst: 0,
  };
}

class CompanionEvolutionBrain {
  private progressions: Record<CompanionId, CompanionProgression>;
  private filePath: string | null = null;
  private onUnlockCallback: ((unlock: CosmeticUnlock) => void) | null = null;

  constructor() {
    const base = {
      pix: makeBaseProgression("pix"),
      kai: makeBaseProgression("kai"),
      zee: makeBaseProgression("zee"),
    };
    this.progressions = {
      pix: { ...base.pix, depth: 0, unlockedCosmetics: [] },
      kai: { ...base.kai, depth: 0, unlockedCosmetics: [] },
      zee: { ...base.zee, depth: 0, unlockedCosmetics: [] },
    };
  }

  init(userDataDir: string): void {
    this.filePath = path.join(userDataDir, FILENAME);
    this.load();
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        if (data && typeof data === "object") {
          for (const id of ["pix", "kai", "zee"] as CompanionId[]) {
            if (data[id]) {
              this.progressions[id] = { ...this.progressions[id], ...data[id] };
            }
          }
        }
      }
    } catch {
      /* start fresh */
    }
  }

  private save(): void {
    if (!this.filePath) return;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.progressions, null, 2));
    } catch {
      /* best effort */
    }
  }

  /** Set a callback fired when a new cosmetic is unlocked. */
  onUnlock(cb: (unlock: CosmeticUnlock) => void): void {
    this.onUnlockCallback = cb;
  }

  /** Record a new conversation (first user message in a session). */
  recordConversation(id: CompanionId): void {
    const p = this.progressions[id];
    p.conversations++;
    if (p.firstInteractionAt === 0) {
      p.firstInteractionAt = Date.now();
    }
    p.daysSinceFirst = Math.floor((Date.now() - p.firstInteractionAt) / (24 * 60 * 60 * 1000));
    this.recompute(id);
  }

  /** Record a message (user or assistant). */
  recordMessage(id: CompanionId): void {
    const p = this.progressions[id];
    p.totalMessages++;
    this.recompute(id);
  }

  /** Record a completed task. */
  recordTask(id: CompanionId): void {
    const p = this.progressions[id];
    p.tasksCompleted++;
    this.recompute(id);
  }

  /** Record a new memory created with this companion. */
  recordMemory(id: CompanionId): void {
    const p = this.progressions[id];
    p.memoriesCreated++;
    this.recompute(id);
  }

  private recompute(id: CompanionId): void {
    const p = this.progressions[id];
    const newDepth = computeDepth(p);
    p.depth = newDepth;

    // Check for cosmetic unlocks
    const available = COSMETICS[id];
    for (const cosmetic of available) {
      const alreadyUnlocked = p.unlockedCosmetics.some((c) => c.tier === cosmetic.tier);
      if (!alreadyUnlocked && p.conversations >= cosmetic.threshold) {
        const unlock: CosmeticUnlock = {
          id: `${id}-tier${cosmetic.tier}`,
          companion: id,
          tier: cosmetic.tier,
          name: cosmetic.name,
          description: cosmetic.description,
          unlockedAt: Date.now(),
        };
        p.unlockedCosmetics.push(unlock);
        if (this.onUnlockCallback) {
          this.onUnlockCallback(unlock);
        }
      }
    }

    this.save();
  }

  getProgression(id: CompanionId): CompanionProgression {
    return { ...this.progressions[id], unlockedCosmetics: [...this.progressions[id].unlockedCosmetics] };
  }

  getAll(): Record<CompanionId, CompanionProgression> {
    return {
      pix: this.getProgression("pix"),
      kai: this.getProgression("kai"),
      zee: this.getProgression("zee"),
    };
  }
}

export const companionEvolution = new CompanionEvolutionBrain();
