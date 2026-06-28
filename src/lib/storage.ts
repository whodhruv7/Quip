// Quip V2 — local storage helpers.
//
// Persists chat sessions (one per companion) + a history of past sessions.
// Also stores user preferences (companion, theme).

import type { ChatMessage, ChatSession, CompanionId } from "@/types";

const CURRENT_KEY_PREFIX = "quip:current:";   // quip:current:pix
const SESSIONS_KEY = "quip:sessions";
const PREFS_KEY = "quip:prefs";

function currentKey(cid: CompanionId) {
  return `${CURRENT_KEY_PREFIX}${cid}`;
}

const uid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

// --- Preferences ---
export interface QuipPrefs {
  companionId: CompanionId;
  theme?: "light" | "dark" | "aqua" | "pink" | "black";
  scanned?: boolean;
}

const DEFAULT_PREFS: QuipPrefs = {
  companionId: "pix",
  theme: "light",
  scanned: false,
};

export function loadPrefs(): QuipPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Partial<QuipPrefs>): void {
  try {
    const current = loadPrefs();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...prefs }));
  } catch {
    /* ignore */
  }
}

// --- Current active messages for a companion ---
export function loadCurrentMessages(cid: CompanionId): ChatMessage[] {
  try {
    const raw = localStorage.getItem(currentKey(cid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCurrentMessages(cid: CompanionId, messages: ChatMessage[]): void {
  try {
    const trimmed = messages.slice(-60);
    localStorage.setItem(currentKey(cid), JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

// --- Archive a session ---
export function archiveSession(cid: CompanionId, messages: ChatMessage[]): void {
  if (messages.length === 0) return;
  const sessions = loadSessions();
  const firstUserMsg = messages.find((m) => m.role === "user");
  sessions.unshift({
    id: uid(),
    companionId: cid,
    messages: messages.slice(-60),
    createdAt: messages[0].ts,
    updatedAt: messages[messages.length - 1].ts,
    title: firstUserMsg?.content.slice(0, 50) || "Untitled",
  });
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 20)));
  } catch {
    /* ignore */
  }
}

// --- Archived sessions list ---
export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearCurrentMessages(cid: CompanionId): void {
  try {
    localStorage.removeItem(currentKey(cid));
  } catch {
    /* ignore */
  }
}
