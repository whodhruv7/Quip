// Quip V2 — COMPANION MOOD SYSTEM
// -----------------------------------------------------------------------------
// Each companion has a dynamic mood (energy, warmth, playfulness, focus) that
// shifts based on time of day, the user's stress signals, recent workload,
// and battery state. The mood subtly affects animation speed and is injected
// as a style hint into the system prompt. Users feel it without noticing it.
//
// Mood updates are throttled (max once per 30s) to avoid thrashing.
// -----------------------------------------------------------------------------

import type { EnvironmentState } from "../../src/types";
import type { CompanionId } from "../../src/types";

export interface CompanionMood {
  energy: number; // 0 = tired, 1 = energetic
  warmth: number; // 0 = formal, 1 = warm
  playfulness: number; // 0 = serious, 1 = playful
  focus: number; // 0 = distracted, 1 = deeply focused
  label: MoodLabel;
  updatedAt: number;
}

export type MoodLabel =
  | "fresh"
  | "focused"
  | "relaxed"
  | "sleepy"
  | "stressed"
  | "playful";

interface CompanionPersonality {
  baseEnergy: number;
  baseWarmth: number;
  basePlayfulness: number;
  baseFocus: number;
}

const PERSONALITIES: Record<CompanionId, CompanionPersonality> = {
  pix: { baseEnergy: 0.8, baseWarmth: 0.7, basePlayfulness: 0.85, baseFocus: 0.5 },
  kai: { baseEnergy: 0.6, baseWarmth: 0.5, basePlayfulness: 0.3, baseFocus: 0.9 },
  ren: { baseEnergy: 0.7, baseWarmth: 0.6, basePlayfulness: 0.5, baseFocus: 0.6 },
};

/** Compute a mood label from mood values. */
function labelFrom(m: Omit<CompanionMood, "label" | "updatedAt">): MoodLabel {
  if (m.energy < 0.25) return "sleepy";
  if (m.focus > 0.75 && m.energy > 0.5) return "focused";
  if (m.energy > 0.75 && m.playfulness > 0.6) return "playful";
  if (m.energy < 0.4 && m.focus < 0.4) return "relaxed";
  if (m.energy < 0.4 && m.warmth < 0.4) return "stressed";
  if (m.energy > 0.6) return "fresh";
  return "relaxed";
}

class CompanionMoodBrain {
  private moods: Record<CompanionId, CompanionMood>;
  private lastUpdate = 0;
  private recentUserStress = 0.5;
  private recentUserWarmth = 0.5;
  private lastEnv: EnvironmentState | null = null;

  constructor() {
    this.moods = {
      pix: this.baseMood("pix"),
      kai: this.baseMood("kai"),
      ren: this.baseMood("ren"),
    };
  }

  private baseMood(id: CompanionId): CompanionMood {
    const p = PERSONALITIES[id];
    const raw = {
      energy: p.baseEnergy,
      warmth: p.baseWarmth,
      playfulness: p.basePlayfulness,
      focus: p.baseFocus,
    };
    return { ...raw, label: labelFrom(raw), updatedAt: 0 };
  }

  /** Called by Environment Brain when env state changes. */
  observeEnvironment(env: EnvironmentState): void {
    this.lastEnv = env;
    this.maybeRecompute();
  }

  /** Called by useChat when a user message arrives. Detect stress/warmth. */
  observeUserMessage(message: string): void {
    const lower = message.toLowerCase();
    // Stress indicators: ALL CAPS, multiple !!!, urgent words
    const urgentWords = ["asap", "urgent", "now", "help", "stuck", "broken", "error", "fail"];
    let stress = 0;
    if (/[A-Z]{5,}/.test(message)) stress += 0.3;
    if (/!{2,}/.test(message)) stress += 0.2;
    if (urgentWords.some((w) => lower.includes(w))) stress += 0.3;
    if (message.length > 200) stress += 0.1;
    this.recentUserStress = Math.min(1, this.recentUserStress * 0.7 + stress * 0.3);

    // Warmth indicators: thanks, friendly words, emojis
    const warmWords = ["thanks", "thank you", "love", "appreciate", "great", "awesome"];
    let warmth = 0;
    if (warmWords.some((w) => lower.includes(w))) warmth += 0.4;
    if (/[\u{1F600}-\u{1F64F}]/u.test(message)) warmth += 0.3;
    this.recentUserWarmth = Math.min(1, this.recentUserWarmth * 0.7 + warmth * 0.3);

    this.maybeRecompute();
  }

  /** Throttled recompute — max once per 30 seconds. */
  private maybeRecompute(): void {
    const now = Date.now();
    if (now - this.lastUpdate < 30_000) return;
    this.lastUpdate = now;
    this.recompute();
  }

  private recompute(): void {
    const hour = new Date().getHours();
    const base = this.lastEnv;

    // Time-of-day energy curve
    let timeEnergy = 0.5;
    if (hour >= 6 && hour < 11) timeEnergy = 0.85; // morning
    else if (hour >= 11 && hour < 14) timeEnergy = 0.7; // midday
    else if (hour >= 14 && hour < 17) timeEnergy = 0.6; // afternoon
    else if (hour >= 17 && hour < 21) timeEnergy = 0.45; // evening
    else timeEnergy = 0.25; // night

    // Battery adjustment
    let batteryAdj = 0;
    if (base && base.battery.supported && !base.battery.charging && base.battery.level < 0.2) {
      batteryAdj = -0.15; // low battery = conserve
    }

    // User stress adjustment: calm down with the user
    const stressAdj = -0.2 * (this.recentUserStress - 0.5);

    for (const id of Object.keys(this.moods) as CompanionId[]) {
      const personality = PERSONALITIES[id];
      const energy = Math.max(
        0,
        Math.min(1, timeEnergy * 0.5 + personality.baseEnergy * 0.4 + batteryAdj + stressAdj)
      );
      const warmth = Math.max(
        0,
        Math.min(1, personality.baseWarmth * 0.7 + this.recentUserWarmth * 0.3)
      );
      const playfulness = personality.basePlayfulness * (1 - this.recentUserStress * 0.4);
      const focus = hour >= 9 && hour < 17 ? 0.8 : 0.4;

      const raw = { energy, warmth, playfulness, focus };
      this.moods[id] = { ...raw, label: labelFrom(raw), updatedAt: Date.now() };
    }
  }

  getMood(id: CompanionId): CompanionMood {
    // Trigger a recompute if stale (> 5 min)
    if (Date.now() - this.lastUpdate > 5 * 60 * 1000) {
      this.lastUpdate = 0;
      this.maybeRecompute();
    }
    return { ...this.moods[id] };
  }

  /** Get a one-line style hint for the system prompt. */
  getPromptHint(id: CompanionId): string {
    const m = this.getMood(id);
    const hints: Record<MoodLabel, string> = {
      fresh: "You're feeling fresh and energetic. Be enthusiastic.",
      focused: "You're in a focused state. Be concise and precise.",
      relaxed: "You're feeling relaxed. Be calm and unhurried.",
      sleepy: "You're a bit sleepy. Be gentle and quiet.",
      stressed: "The user seems stressed. Be extra calm and supportive.",
      playful: "You're feeling playful. Light humor is welcome.",
    };
    return `Mood: ${m.label}. ${hints[m.label]}`;
  }

  /** Get animation speed multiplier for the companion sprite. */
  getAnimationSpeed(id: CompanionId): number {
    const m = this.getMood(id);
    // Energy 0 → 0.5x speed, energy 1 → 1.5x speed
    return 0.5 + m.energy;
  }
}

export const companionMood = new CompanionMoodBrain();
