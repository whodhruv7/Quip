// Quip V2 — local storage helpers.
//
// Persists chat sessions (one per companion) + a history of past sessions.
// Also stores user preferences (companion, theme).

import type { ChatMessage, ChatSession, CompanionId } from "@/types";

const CURRENT_KEY_PREFIX = "quip:current:";   // quip:current:pix
const SESSIONS_KEY = "quip:sessions";
const PREFS_KEY = "quip:prefs";

// All valid companion ids (kept in sync with companion-config).
const VALID_COMPANION_IDS = new Set<string>([
  "pix", "kai", "ren", "bubbles", "capy", "ivy",
]);

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
    const parsed = JSON.parse(raw) as Partial<QuipPrefs> & { companionId?: string };
    // Migration: older builds used "zee" — it is "ren" now.
    if ((parsed.companionId as string) === "zee") {
      parsed.companionId = "ren";
    }
    if (parsed.companionId && !VALID_COMPANION_IDS.has(parsed.companionId)) {
      delete parsed.companionId;
    }
    return { ...DEFAULT_PREFS, ...parsed };
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
    let raw = localStorage.getItem(currentKey(cid));
    // Migration: older builds stored Ren's messages under "zee".
    if (!raw && cid === "ren") {
      raw = localStorage.getItem(`${CURRENT_KEY_PREFIX}zee`);
      if (raw) {
        try {
          localStorage.setItem(currentKey("ren"), raw);
          localStorage.removeItem(`${CURRENT_KEY_PREFIX}zee`);
        } catch {
          /* ignore */
        }
      }
    }
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
