// Quip V2 — application root.
//
<<<<<<< HEAD
// SIMPLE LAYOUT:
//   - Companion sprite: bottom-right corner, ALWAYS visible (zIndex 100)
//   - Chat panel: floats ABOVE the companion (gap between them), toggles on tap
//   - Tap companion = open chat. Tap again = close chat. Fast. Simple.
//   - No tap-outside catcher (was causing companion tap issues)
//   - X button in chat closes it too
//
// The companion is NEVER hidden by the chat panel — they're stacked vertically.

import { useCallback, useEffect, useRef, useState } from "react";
=======
// CRITICAL FIX (Companion Toggle):
//   - Single tap opens chat. Next tap (or X, or tap-outside) closes it.
//   - On close, conversation is saved to history (not lost).
//   - No stacking: 200ms debounce prevents rapid-tap thrash.
//   - On reopen, conversation restores from history.
//
// Layout: Companion is ALWAYS visible (bottom-center, floating, draggable).
// Chat PANEL toggles open/closed ABOVE the companion. Settings overlays everything.
// NO ScanOverlay — app opens instantly.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
import { AnimatePresence, motion } from "framer-motion";
import { Companion } from "@/components/Companion";
import { TopBar } from "@/components/TopBar";
import { ChatLayout } from "@/components/ChatLayout";
import { ChatWelcome } from "@/components/ChatWelcome";
import { ChatInput } from "@/components/ChatInput";
<<<<<<< HEAD
import { ScanOverlay } from "@/components/ScanOverlay";
import { SettingsPanel } from "@/components/SettingsPanel";
import { useChat } from "@/hooks/useChat";
import { useWindowDrag } from "@/hooks/useWindowDrag";
=======
import { SettingsPanel } from "@/components/SettingsPanel";
import { useChat } from "@/hooks/useChat";
import { useSpatialLayout } from "@/hooks/useSpatialLayout";
import { useKeyboardShortcuts } from "@/hooks/useKeyboard";
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
import {
  loadPrefs,
  savePrefs,
  loadCurrentMessages,
  saveCurrentMessages,
  archiveSession,
} from "@/lib/storage";
import { getCompanion } from "@/lib/companion-config";
import type { ChatMessage, CompanionId, PixState } from "@/types";

<<<<<<< HEAD
// ─── Layout constants ───────────────────────────────────────────────────────
const COMPANION_SIZE = 72;
const COMPANION_MARGIN = 24;        // distance from screen edge
const PANEL_GAP = 12;               // gap between companion top and panel bottom
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 520;

// Chat state: simple toggle. open = visible, closed = hidden.
type ChatState = "closed" | "open";

export default function App() {
  const [companionId, setCompanionId] = useState<CompanionId>(() => loadPrefs().companionId);
  const [chatState, setChatState] = useState<ChatState>("closed");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanDone, setScanDone] = useState(false);
=======
// ─── Chat State Machine ─────────────────────────────────────────────────────
type ChatState = "idle" | "open";

const TAP_DEBOUNCE_MS = 150;
const CLOSE_ANIMATION_MS = 120;
const COMPANION_POS_KEY = "quip:companion-position";
const FLOATING_HINTS = ["Need help?", "Need suggestion?", "Ask a question?"];

type Point = { x: number; y: number };

function loadCompanionPosition(): Point | null {
  try {
    const raw = localStorage.getItem(COMPANION_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number"
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveCompanionPosition(pos: Point): void {
  try {
    localStorage.setItem(COMPANION_POS_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [companionId, setCompanionId] = useState<CompanionId>(() => loadPrefs().companionId);
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  const [hovering, setHovering] = useState(false);
  const [moodSpeed, setMoodSpeed] = useState(1);
  const [cosmetics, setCosmetics] = useState<string[]>([]);
  const [unlockToast, setUnlockToast] = useState<string | null>(null);
<<<<<<< HEAD

=======
  const [floatingHint, setFloatingHint] = useState<string | null>(null);
  const [companionPos, setCompanionPos] = useState<Point>(() => {
    const saved = loadCompanionPosition();
    return saved ?? { x: typeof window !== "undefined" ? window.innerWidth / 2 : 360, y: typeof window !== "undefined" ? window.innerHeight - 160 : 560 };
  });

  // Restore messages from storage on mount
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  const [restoredMessages, setRestoredMessages] = useState<ChatMessage[]>(() =>
    loadCurrentMessages(companionId)
  );

<<<<<<< HEAD
  const { messages, busy: chatBusy, error, send, newChat, clearError } = useChat(companionId, restoredMessages);
  const drag = useWindowDrag(true);

  // ─── Toggle: tap companion = open/close chat ───────────────────────────
  const lastTap = useRef(0);

  const handleCompanionTap = useCallback(() => {
    // Ignore if this was a drag, not a tap
    if (drag.totalMoved() > 5) return;

    // Debounce: 150ms between taps (fast but no thrash)
    const now = Date.now();
    if (now - lastTap.current < 150) return;
    lastTap.current = now;

    setChatState((prev) => (prev === "open" ? "closed" : "open"));
  }, [drag]);

  // ─── Close chat (from X button) ────────────────────────────────────────
  const handleClose = useCallback(() => {
    setChatState("closed");
    saveCurrentMessages(companionId, messages);
  }, [companionId, messages]);

  // ─── New chat ──────────────────────────────────────────────────────────
=======
  const { messages, busy: chatBusy, error, send, newChat, clearError, sessions, openSession } = useChat(companionId, restoredMessages);
  const spatial = useSpatialLayout();

  // Debounce tracking
  const lastStateChange = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPos: Point;
    moved: boolean;
  } | null>(null);
  const hintTimeoutRef = useRef<number | null>(null);

  const clampCompanion = useCallback((next: Point) => {
    const width = typeof window !== "undefined" ? window.innerWidth : 1280;
    const height = typeof window !== "undefined" ? window.innerHeight : 800;
    return {
      x: Math.min(Math.max(56, next.x), Math.max(56, width - 56)),
      y: Math.min(Math.max(74, next.y), Math.max(74, height - 74)),
    };
  }, []);

  // ─── Toggle Handler ──────────────────────────────────────────────────────
  const handleCompanionTap = useCallback(() => {
    const now = Date.now();
    if (now - lastStateChange.current < TAP_DEBOUNCE_MS) return;
    lastStateChange.current = now;
    setHistoryOpen(false);
    setChatState((prev) => {
      if (prev === "open") {
        saveCurrentMessages(companionId, messages);
        archiveSession(companionId, messages);
        return "idle";
      }
      return "open";
    });
  }, [companionId, messages]);

  const handleCompanionPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPos: companionPos,
        moved: false,
      };
    },
    [companionPos]
  );

  const handleCompanionPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 6) {
        drag.moved = true;
      }
      if (!drag.moved) return;
      const next = clampCompanion({
        x: drag.startPos.x + dx,
        y: drag.startPos.y + dy,
      });
      setCompanionPos(next);
    },
    [clampCompanion]
  );

  const handleCompanionPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
      saveCompanionPosition(companionPos);
      if (!drag.moved) {
        handleCompanionTap();
      }
    },
    [companionPos, handleCompanionTap]
  );

  const handleCompanionPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      saveCompanionPosition(companionPos);
    },
    [companionPos]
  );

  // ─── Close handler ────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    const now = Date.now();
    if (now - lastStateChange.current < TAP_DEBOUNCE_MS) return;
    lastStateChange.current = now;
    saveCurrentMessages(companionId, messages);
    archiveSession(companionId, messages);
    setChatState("idle");
    setHistoryOpen(false);
  }, [companionId, messages]);

  // ─── New chat handler ────────────────────────────────────────────────────
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  const handleNewChat = useCallback(() => {
    newChat();
    setRestoredMessages([]);
    saveCurrentMessages(companionId, []);
<<<<<<< HEAD
  }, [companionId, newChat]);

  // ─── Switch companion ──────────────────────────────────────────────────
=======
    setHistoryOpen(false);
  }, [companionId, newChat]);

  // ─── Companion switch ────────────────────────────────────────────────────
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  const switchCompanion = useCallback((id: CompanionId) => {
    saveCurrentMessages(companionId, messages);
    setCompanionId(id);
    savePrefs({ companionId: id });
    try {
      window.quip.setCompanion(id);
<<<<<<< HEAD
    } catch {
      /* non-fatal */
    }
    const restored = loadCurrentMessages(id);
    setRestoredMessages(restored);
  }, [companionId, messages]);

  // ─── On mount: tell main which companion is active ─────────────────────
  useEffect(() => {
    try {
      window.quip.setCompanion(companionId);
    } catch {
      /* non-fatal */
    }
  }, [companionId]);

  // ─── Fetch mood + cosmetics ────────────────────────────────────────────
=======
    } catch { /* non-fatal */ }
    const restored = loadCurrentMessages(id);
    setRestoredMessages(restored);
    setChatState(restored.length > 0 ? "open" : "idle");
    setHistoryOpen(false);
  }, [companionId, messages]);

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────
  useKeyboardShortcuts({
    onToggleChat: handleCompanionTap,
    onCloseChat: handleClose,
    onOpenSettings: () => setSettingsOpen(true),
    onNewChat: handleNewChat,
    onSwitchCompanion: switchCompanion,
    isSettingsOpen: settingsOpen,
  });

  // ─── On mount: tell main which companion is active ────────────────────────
  useEffect(() => {
    try { window.quip.setCompanion(companionId); } catch { /* non-fatal */ }
  }, [companionId]);

  // ─── Fetch companion mood + cosmetics ────────────────────────────────────
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  useEffect(() => {
    let active = true;
    const fetchMood = async () => {
      try {
        const mood = await window.quip.getCompanionMood(companionId);
        if (active && mood && typeof (mood as any).energy === "number") {
          setMoodSpeed(0.5 + (mood as any).energy);
        }
<<<<<<< HEAD
      } catch {
        /* non-fatal */
      }
=======
      } catch { /* non-fatal */ }
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
    };
    const fetchCosmetics = async () => {
      try {
        const prog = await window.quip.getCompanionProgression();
        if (active && prog) {
          const p = (prog as any)[companionId];
          if (p?.unlockedCosmetics) {
            setCosmetics(p.unlockedCosmetics.map((c: any) => c.id));
          }
        }
<<<<<<< HEAD
      } catch {
        /* non-fatal */
      }
=======
      } catch { /* non-fatal */ }
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
    };
    fetchMood();
    fetchCosmetics();
    const interval = setInterval(fetchMood, 60_000);
<<<<<<< HEAD
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [companionId]);

  // ─── Listen for cosmetic unlocks ───────────────────────────────────────
=======
    return () => { active = false; clearInterval(interval); };
  }, [companionId]);

  // ─── Keep the window interactive so the companion can always be tapped/dragged ─
  useEffect(() => {
    try {
      window.quip.setIgnoreMouseEvents(false);
    } catch { /* non-fatal */ }
  }, []);

  // ─── Listen for cosmetic unlocks ────────────────────────────────────────
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  useEffect(() => {
    const off = window.quip.onCosmeticUnlock((unlock: any) => {
      if (unlock && unlock.companion === companionId) {
        setUnlockToast(unlock.name);
        setCosmetics((prev) => [...prev, unlock.id]);
        setTimeout(() => setUnlockToast(null), 4000);
        window.quip.getCompanionProgression().then((prog) => {
          if (prog) {
            const p = (prog as any)[companionId];
            if (p?.unlockedCosmetics) {
              setCosmetics(p.unlockedCosmetics.map((c: any) => c.id));
            }
          }
        }).catch(() => {});
      }
    });
    return off;
  }, [companionId]);

<<<<<<< HEAD
  // ─── Companion animation state ─────────────────────────────────────────
=======
  // ─── Persist messages on every change ────────────────────────────────────
  useEffect(() => {
    if (chatState === "open" && messages.length > 0) {
      saveCurrentMessages(companionId, messages);
    }
  }, [messages, companionId, chatState]);

  useEffect(() => {
    saveCompanionPosition(companionPos);
  }, [companionPos]);

  useEffect(() => {
    setCompanionPos((prev) => clampCompanion(prev));
  }, [clampCompanion, spatial?.windowSize.width, spatial?.windowSize.height]);

  // ─── Companion animation state ───────────────────────────────────────────
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  const isResponding =
    chatBusy &&
    messages.some((m) => m.role === "assistant" && m.streaming && m.content.length > 0);
  const pixState: PixState = chatBusy
<<<<<<< HEAD
    ? isResponding
      ? "responding"
      : "thinking"
    : hovering
      ? "hover"
      : "idle";

  const theme = getCompanion(companionId);
  const showPanel = chatState === "open";
=======
    ? isResponding ? "responding" : "thinking"
    : hovering ? "hover" : "idle";

  const theme = getCompanion(companionId);
  const showPanel = chatState === "open";
  const panelInteractive = chatState === "open";
  const historyCount = sessions.length;
  const panelWidth = Math.min(420, Math.max(340, (spatial?.windowSize.width ?? 420) * 0.34));
  const panelHeight = Math.min(560, Math.max(460, (spatial?.windowSize.height ?? 560) * 0.56));
  const companionBottom = 118;

  useEffect(() => {
    if (showPanel || chatBusy || settingsOpen || historyOpen) {
      setFloatingHint(null);
      if (hintTimeoutRef.current) {
        window.clearTimeout(hintTimeoutRef.current);
        hintTimeoutRef.current = null;
      }
      return;
    }
    const pick = () => {
      const next = FLOATING_HINTS[Math.floor(Math.random() * FLOATING_HINTS.length)];
      setFloatingHint(next);
      if (hintTimeoutRef.current) window.clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = window.setTimeout(() => {
        setFloatingHint((current) => (current === next ? null : current));
        hintTimeoutRef.current = null;
      }, 5500);
    };
    pick();
    const interval = window.setInterval(pick, 18000);
    return () => {
      window.clearInterval(interval);
      if (hintTimeoutRef.current) {
        window.clearTimeout(hintTimeoutRef.current);
        hintTimeoutRef.current = null;
      }
    };
  }, [showPanel, chatBusy, settingsOpen, historyOpen]);
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        pointerEvents: "none",
<<<<<<< HEAD
      }}
    >
      {/* ─── CHAT PANEL — floats above companion ────────────────────────── */}
      {/* Positioned: bottom-right, offset UP so companion is visible below */}
      <div
        style={{
          position: "absolute",
          right: COMPANION_MARGIN,
          bottom: COMPANION_SIZE + COMPANION_MARGIN + PANEL_GAP,
          pointerEvents: "none",
          zIndex: 50,
        }}
      >
        <AnimatePresence>
          {showPanel && (
            <motion.div
              key="chat-panel"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                transition: {
                  type: "spring",
                  stiffness: 400,
                  damping: 30,
                  mass: 0.7,
                },
              }}
              exit={{
                opacity: 0,
                y: 15,
                scale: 0.96,
                transition: { duration: 0.15, ease: [0.4, 0, 1, 1] },
              }}
              style={{
                pointerEvents: "auto",
                width: PANEL_WIDTH,
                height: PANEL_HEIGHT,
                borderRadius: 20,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                background: "rgba(255,255,255,0.72)",
                backdropFilter: "blur(30px) saturate(180%)",
                WebkitBackdropFilter: "blur(30px) saturate(180%)",
                border: "1px solid rgba(255,255,255,0.6)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.03)",
              }}
            >
=======
        overflow: "hidden",
      }}
    >
      {/* ─── Tap-outside catcher (closes chat when tapping outside) ──────── */}
      {showPanel && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "auto",
            zIndex: 5,
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              handleClose();
            }
          }}
        />
      )}

      {/* ─── Chat PANEL — ABOVE companion ─────────────────────────────── */}
      <div
        style={{
          position: "absolute",
          left: companionPos.x,
          bottom: "auto",
          top: companionPos.y - 74 - 12, // 74 = half companion height, 12 = gap
          transform: "translateX(-50%) translateY(-100%)",
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { type: "spring", stiffness: 420, damping: 38, mass: 0.65 },
            }}
            style={{
              pointerEvents: panelInteractive ? "auto" : "none",
              width: panelWidth,
              height: panelHeight,
              borderRadius: 24,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              background: "rgba(252,253,255,0.97)",
              backdropFilter: "blur(22px) saturate(140%)",
              WebkitBackdropFilter: "blur(22px) saturate(140%)",
              border: "1px solid rgba(255,255,255,0.82)",
              boxShadow:
                "0 30px 90px rgba(0,0,0,0.16), 0 0 0 1px rgba(255,255,255,0.28)",
            }}
          >
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
              <TopBar
                companionId={companionId}
                onCompanionChange={switchCompanion}
                onSettingsToggle={() => setSettingsOpen(true)}
                onNewChat={handleNewChat}
<<<<<<< HEAD
=======
                onHistoryToggle={() => setHistoryOpen((v) => !v)}
                historyCount={historyCount}
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
                onClose={handleClose}
              />

              {/* Error banner */}
              {error && (
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 11,
                    color: "#dc2626",
                    background: "rgba(254,235,235,0.7)",
                    borderBottom: "1px solid rgba(239,68,68,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span style={{ flex: 1 }}>{error}</span>
                  <button
                    onClick={clearError}
                    style={{
                      fontSize: 10,
                      color: "#dc2626",
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "rgba(239,68,68,0.1)",
                      border: "none",
                      cursor: "pointer",
                    }}
                    aria-label="Dismiss error"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Body */}
              <div className="relative flex flex-1 flex-col overflow-hidden">
<<<<<<< HEAD
                {messages.length === 0 ? (
                  <ChatWelcome companionId={companionId} onSuggestionClick={send} />
                ) : (
                  <ChatLayout messages={messages} busy={chatBusy} />
=======
                {historyOpen && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 30,
                      display: "flex",
                      flexDirection: "column",
                      background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(246,248,252,0.98))",
                      backdropFilter: "blur(16px)",
                      WebkitBackdropFilter: "blur(16px)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 14px",
                        borderBottom: "1px solid rgba(0,0,0,0.06)",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      <span>Chat history</span>
                      <button
                        onClick={() => setHistoryOpen(false)}
                        style={{
                          border: "none",
                          background: "rgba(0,0,0,0.04)",
                          borderRadius: 999,
                          padding: "4px 10px",
                          cursor: "pointer",
                        }}
                      >
                        Close
                      </button>
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
                      {sessions.length === 0 ? (
                        <div style={{ color: "#6b7280", fontSize: 13, padding: 12 }}>
                          No archived chats yet.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          {sessions.slice(0, 20).map((session) => (
                            <button
                              key={session.id}
                              onClick={() => {
                                openSession(session);
                                setHistoryOpen(false);
                                setChatState("open");
                              }}
                              style={{
                                textAlign: "left",
                                border: "1px solid rgba(0,0,0,0.06)",
                                background: "rgba(255,255,255,0.9)",
                                borderRadius: 16,
                                padding: 12,
                                cursor: "pointer",
                                boxShadow: "0 10px 30px rgba(15,23,42,0.05)",
                              }}
                            >
                              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                                {session.title || "Untitled"}
                              </div>
                              <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}>
                                {new Date(session.updatedAt).toLocaleString()}
                              </div>
                              <div style={{ marginTop: 8, fontSize: 11, color: "#374151", lineHeight: 1.4 }}>
                                {session.messages
                                  .filter((m) => m.role === "user")
                                  .slice(0, 2)
                                  .map((m) => m.content)
                                  .join(" · ") || "Open to continue."}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {!historyOpen && (
                  messages.length === 0 ? (
                    <ChatWelcome companionId={companionId} onSuggestionClick={send} />
                  ) : (
                    <ChatLayout messages={messages} busy={chatBusy} />
                  )
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
                )}
              </div>

              {/* Input */}
              <ChatInput onSend={send} busy={chatBusy} companionId={companionId} />

              {/* Settings overlay */}
              <SettingsPanel
                open={settingsOpen}
                companionId={companionId}
                onCompanionChange={switchCompanion}
                onClose={() => setSettingsOpen(false)}
              />
<<<<<<< HEAD
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── COMPANION SPRITE — ALWAYS visible, bottom-right ─────────────── */}
      {/* zIndex 100 = always on top of chat panel */}
      <div
        role="button"
        aria-label={`${theme.name} companion — tap to ${showPanel ? "close" : "open"} chat`}
        tabIndex={0}
        style={{
          position: "absolute",
          right: COMPANION_MARGIN,
          bottom: COMPANION_MARGIN,
          width: COMPANION_SIZE + 8,
          height: COMPANION_SIZE + 16,
          pointerEvents: "auto",
          cursor: "grab",
          zIndex: 100,
=======
          </motion.div>
        )}
      </div>

      {/* ─── COMPANION SPRITE — draggable floating anchor ─────────────── */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: companionPos.x,
          top: companionPos.y,
          transform: "translate(-50%, -50%)",
          width: 160,
          height: 52,
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 50%, ${theme.primary}30 0%, ${theme.primary}18 34%, transparent 72%)`,
          filter: "blur(14px)",
          opacity: 0.9,
          pointerEvents: "none",
          zIndex: 14,
        }}
      />
      <div
        role="button"
        aria-label={`${theme.name} — tap to ${showPanel ? "close" : "open"} chat`}
        tabIndex={0}
        style={{
          position: "absolute",
          left: companionPos.x,
          top: companionPos.y,
          transform: "translate(-50%, -50%)",
          width: 112,
          height: 124,
          pointerEvents: "auto",
          cursor: "grab",
          transition: "filter 200ms",
          zIndex: 20,
          flexShrink: 0,
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCompanionTap();
          }
        }}
<<<<<<< HEAD
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={(e) => {
          drag.onPointerUp(e);
          handleCompanionTap();
        }}
      >
        <Companion
          id={companionId}
          state={pixState}
          size={COMPANION_SIZE}
=======
        onPointerEnter={() => {
          setHovering(true);
          (document.activeElement as HTMLElement)?.blur?.();
        }}
        onPointerLeave={() => setHovering(false)}
        onPointerDown={handleCompanionPointerDown}
        onPointerMove={handleCompanionPointerMove}
        onPointerUp={handleCompanionPointerUp}
        onPointerCancel={handleCompanionPointerCancel}
      >
        {floatingHint && !showPanel && !historyOpen && !settingsOpen && !chatBusy && (
          <div
            style={{
              position: "absolute",
              top: -34,
              left: "50%",
              transform: "translateX(-50%)",
              whiteSpace: "nowrap",
              fontSize: 11,
              fontWeight: 600,
              color: "#111827",
              background: "rgba(255,255,255,0.94)",
              padding: "6px 10px",
              borderRadius: 999,
              boxShadow: "0 14px 30px rgba(15,23,42,0.10)",
              border: "1px solid rgba(255,255,255,0.72)",
              pointerEvents: "none",
            }}
          >
            {floatingHint}
          </div>
        )}
        <Companion
          id={companionId}
          state={pixState}
          size={84}
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
          unlockedCosmetics={cosmetics}
          moodSpeed={moodSpeed}
        />

        {/* Status pill */}
        <AnimatePresence>
          {chatBusy && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              style={{
                position: "absolute",
                bottom: -4,
                left: "50%",
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
                fontSize: 10,
                fontWeight: 500,
                color: theme.primary,
                background: "rgba(255,255,255,0.95)",
                padding: "2px 8px",
                borderRadius: 10,
                boxShadow: `0 2px 8px ${theme.primary}18`,
                border: `1px solid ${theme.primary}20`,
              }}
            >
              {isResponding ? "typing…" : "thinking…"}
            </motion.div>
          )}
        </AnimatePresence>

<<<<<<< HEAD
        {/* "Tap to open" hint when panel closed */}
        <AnimatePresence>
          {!showPanel && !chatBusy && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              style={{
                position: "absolute",
                top: -22,
                left: "50%",
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
                fontSize: 10,
                fontWeight: 500,
                color: "#6b7280",
                background: "rgba(255,255,255,0.95)",
                padding: "3px 9px",
                borderRadius: 10,
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                border: "1px solid rgba(0,0,0,0.04)",
                pointerEvents: "none",
              }}
            >
              tap me
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bootstrap scan overlay — only on first launch */}
      {!scanDone && (
        <ScanOverlay companionId={companionId} onDone={() => setScanDone(true)} />
      )}

=======
        {/* Hint bubble is handled by floatingHint above */}
      </div>

>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
      {/* Cosmetic unlock toast */}
      <AnimatePresence>
        {unlockToast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            style={{
              position: "absolute",
              bottom: 130,
              right: 20,
<<<<<<< HEAD
              zIndex: 200,
=======
              zIndex: 30,
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
              pointerEvents: "none",
              background: "rgba(255,255,255,0.95)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              borderRadius: 12,
              padding: "10px 16px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
              border: "1px solid rgba(255,255,255,0.6)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>✨</span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#111" }}>
                New unlock!
              </span>
              <span style={{ fontSize: 11, color: "#6b7280" }}>
                {unlockToast}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
