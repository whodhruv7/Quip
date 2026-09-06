// Quip — Proactive Companion Messages (Skales-inspired router, Quip identity)
// ─────────────────────────────────────────────────────────────────────────────
// Subtle, non-spammy companion check-ins:
//   - Quiet hours (22:00–07:00): no messages
//   - Per-type cooldowns persisted in localStorage (never repeat within hours)
//   - Suppress while Quip is busy or when the last message is already proactive
//   - Rotating message categories: check-in, hydration, break, help, greeting
// The newest proactive message also renders as a small on-screen bubble
// (QuipSay) near the companion.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import type { ChatMessage, CompanionId } from "@/types";

export interface ProactivePhrase {
  type: string;
  text: string;
}

export const PROACTIVE_PHRASES: ProactivePhrase[] = [
  { type: "check-in", text: "Hey, what's up? 👋" },
  { type: "check-in", text: "Just checking in — need any help?" },
  { type: "help", text: "I'm here if you want to bounce some ideas around." },
  { type: "help", text: "Want me to open something for you? Just ask." },
  { type: "hydration", text: "Drink some water — stay hydrated! 💧" },
  { type: "hydration", text: "Hydration check! Grab a glass of water." },
  { type: "break", text: "Quick screen break? Your eyes will thank you." },
  { type: "break", text: "You've been at it a while — stretch for a second." },
  { type: "greeting", text: "Hello! Any fun projects happening today?" },
  { type: "greeting", text: "Just hanging out here. Need anything?" },
];

const MIN_CHECKIN_DELAY_MS = 5 * 60 * 1000;      // 5 min minimum between messages
const MAX_CHECKIN_DELAY_MS = 14 * 60 * 1000;     // ~14 min max
const QUIET_HOUR_START = 22;                      // 22:00
const QUIET_HOUR_END = 7;                         // 07:00
const COOLDOWN_STORE = "quip:proactive-cooldowns";
const DEFAULT_COOLDOWN_MIN = 45;

function loadCooldowns(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COOLDOWN_STORE);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function saveCooldowns(cooldowns: Record<string, number>): void {
  try {
    localStorage.setItem(COOLDOWN_STORE, JSON.stringify(cooldowns));
  } catch {
    /* ignore */
  }
}

export function isQuietHours(now = new Date()): boolean {
  const hour = now.getHours();
  return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
}

export function isOnCooldown(type: string, cooldowns: Record<string, number>, now = Date.now()): boolean {
  const last = cooldowns[type];
  if (!last) return false;
  return now - last < DEFAULT_COOLDOWN_MIN * 60 * 1000;
}

export function pickProactivePhrase(
  cooldowns: Record<string, number>,
  now = Date.now()
): ProactivePhrase | null {
  const candidates = PROACTIVE_PHRASES.filter(
    (p) => !isOnCooldown(p.type, cooldowns, now)
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function useProactiveCheckIn(
  messages: ChatMessage[],
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  busy: boolean,
  companionId: CompanionId
) {
  useEffect(() => {
    if (busy) return;

    const delay = MIN_CHECKIN_DELAY_MS + Math.random() * (MAX_CHECKIN_DELAY_MS - MIN_CHECKIN_DELAY_MS);

    const timer = setTimeout(() => {
      // Quiet hours: absolutely no proactive pings late at night
      if (isQuietHours()) return;

      // Don't stack proactive messages
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant" && lastMsg.proactive) return;

      const cooldowns = loadCooldowns();
      const phrase = pickProactivePhrase(cooldowns);
      if (!phrase) return;

      cooldowns[phrase.type] = Date.now();
      saveCooldowns(cooldowns);

      setMessages((prev) => {
        const prevLast = prev[prev.length - 1];
        if (prevLast && prevLast.role === "assistant" && prevLast.proactive) {
          return prev;
        }
        return [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            content: phrase.text,
            ts: Date.now(),
            companionId,
            proactive: true,
          }
        ];
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [messages, busy, companionId, setMessages]);
}
