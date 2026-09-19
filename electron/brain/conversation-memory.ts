// Quip Head Brain — Conversation Memory
// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 STEP 9 (Chat Memory) of the Understanding Engine spec.
// Remembers, ONLY inside the current conversation:
//   • the last Understanding (goal, intents, objects, classification)
//   • recent interactions (bounded ring) so "it / that / another one" resolve
//   • the current topic
// Cheap, in-memory, expires after inactivity. Never sent wholesale to the
// model — only a compact summary line (token diet).
// This COMPLEMENTS engine/context-store.ts (execution state); it stores the
// UNDERSTANDING layer, not the device state layer.
// ─────────────────────────────────────────────────────────────────────────────

import type { Understanding } from "./understanding";

export interface MemoryInteraction {
  at: number;
  /** Reference-resolved command the user gave. */
  command: string;
  goal: string;
  classification: Understanding["classification"];
  /** Primary intent kind (e.g. OPEN / PLAY / SEARCH). */
  primaryIntent: string;
  /** Objects in the order they appeared ("VS Code" → app). */
  objects: Array<{ name: string; type: string; confidence: number }>;
  /** The final target that was acted on, when known. */
  actedTarget?: string;
  actedTargetType?: string;
}

export interface ConversationMemoryState {
  topic?: string;
  last?: MemoryInteraction;
  recent: MemoryInteraction[];
  updatedAt: number;
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes of inactivity
const RING_SIZE = 8;

let state: ConversationMemoryState = { recent: [], updatedAt: 0 };

function clearExpired(now: number = Date.now()): void {
  if (state.updatedAt && now - state.updatedAt > TTL_MS) {
    state = { recent: [], updatedAt: 0 };
  }
}

/**
 * Remember one resolved interaction. Called by the brain hub after every
 * understanding (even when execution later fails — understanding happened).
 */
export function rememberInteraction(u: Understanding, actedTarget?: string): void {
  clearExpired();
  const entry: MemoryInteraction = {
    at: Date.now(),
    command: u.resolved || u.literal,
    goal: u.meaning,
    classification: u.classification,
    primaryIntent: u.intents.primary.kind,
    objects: u.objects.map((o) => ({ name: o.name, type: o.type, confidence: o.confidence })),
    actedTarget: actedTarget ?? lastActedTargetOf(u),
    actedTargetType: lastActedTargetTypeOf(u),
  };
  state = {
    topic: deriveTopic(u, state.topic),
    last: entry,
    recent: [...state.recent, entry].slice(-RING_SIZE),
    updatedAt: Date.now(),
  };
}

function lastActedTargetOf(u: Understanding): string | undefined {
  const o = u.objects.find(
    (x) => x.type === "app" || x.type === "website" || x.type === "file" || x.type === "folder" || x.type === "song"
  );
  return o?.name;
}

function lastActedTargetTypeOf(u: Understanding): string | undefined {
  const o = u.objects.find(
    (x) => x.type === "app" || x.type === "website" || x.type === "file" || x.type === "folder" || x.type === "song"
  );
  return o?.type;
}

/** The topic follows the strongest object mentioned, kept across turns. */
function deriveTopic(u: Understanding, prev?: string): string | undefined {
  const strong = u.objects.find((o) => o.confidence >= 0.7 && o.type !== "unknown");
  return strong ? `${strong.type}:${strong.name.toLowerCase()}` : prev;
}

export function conversationMemoryGet(): ConversationMemoryState {
  clearExpired();
  return { ...state, recent: [...state.recent] };
}

/** The last interaction whose object matches a wanted type (for "close it"). */
export function lastObjectOfType(type: string): MemoryInteraction | null {
  clearExpired();
  if (!state.last) return null;
  const hit = state.last.objects.find((o) => o.type === type);
  return hit ? state.last : null;
}

/** Compact summary for model prompts — one short line, never a dump. */
export function conversationMemorySummary(): string {
  clearExpired();
  if (!state.last) return "";
  const l = state.last;
  const obj = l.objects
    .slice(0, 2)
    .map((o) => `${o.type}="${o.name}"`)
    .join(", ");
  const parts = [l.goal ? `lastGoal="${l.goal}"` : "", l.primaryIntent ? `lastIntent=${l.primaryIntent}` : "", obj].filter(
    Boolean
  );
  return parts.length ? `Recent: ${parts.join(", ")}` : "";
}

/** Test/refresh helper. */
export function conversationMemoryReset(): void {
  state = { recent: [], updatedAt: 0 };
}
