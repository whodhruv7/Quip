// Quip V2 — application root.
//
// CRITICAL FIX (Companion Toggle):
//   - Single tap opens chat. Next tap (or X, or tap-outside) closes it.
//   - On close, conversation is saved to history (not lost).
//   - No stacking: 200ms debounce prevents rapid-tap thrash.
//   - On reopen, conversation restores from history.
//
// Layout: Companion is ALWAYS visible (bottom-right, floating, draggable).
// Chat PANEL toggles open/closed. Settings overlays everything.

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Companion } from "@/components/Companion";
import { TopBar } from "@/components/TopBar";
import { ChatLayout } from "@/components/ChatLayout";
import { ChatWelcome } from "@/components/ChatWelcome";
import { ChatInput } from "@/components/ChatInput";
import { ScanOverlay } from "@/components/ScanOverlay";
import { SettingsPanel } from "@/components/SettingsPanel";
import { useChat } from "@/hooks/useChat";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import { useSpatialLayout } from "@/hooks/useSpatialLayout";
import { useKeyboardShortcuts } from "@/hooks/useKeyboard";
import {
  loadPrefs,
  savePrefs,
  loadCurrentMessages,
  saveCurrentMessages,
  archiveSession,
} from "@/lib/storage";
import { getCompanion } from "@/lib/companion-config";
import type { ChatMessage, CompanionId, PixState } from "@/types";

// ─── Chat State Machine ─────────────────────────────────────────────────────
// idle     → chat closed, no recent conversation
// open     → chat visible, accepting input
// closing  → close animation playing (150ms), taps ignored
// history  → chat closed, but conversation saved — reopen restores it
type ChatState = "idle" | "open" | "closing" | "history";

const TAP_DEBOUNCE_MS = 200;
const CLOSE_ANIMATION_MS = 180;

export default function App() {
  const [companionId, setCompanionId] = useState<CompanionId>(() => loadPrefs().companionId);
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [moodSpeed, setMoodSpeed] = useState(1);
  const [cosmetics, setCosmetics] = useState<string[]>([]);
  const [unlockToast, setUnlockToast] = useState<string | null>(null);
  const [companionScreenPos, setCompanionScreenPos] = useState<{ x: number; y: number } | null>(null);

  // Restore messages from storage on mount (history persistence)
  const [restoredMessages, setRestoredMessages] = useState<ChatMessage[]>(() =>
    loadCurrentMessages(companionId)
  );

  const { messages, busy: chatBusy, error, send, newChat, clearError } = useChat(companionId, restoredMessages);
  const drag = useWindowDrag(true);
  const spatial = useSpatialLayout();

  // Debounce tracking — prevents rapid-tap stacking
  const lastStateChange = useRef(0);
  const isAnimatingClose = useRef(false);

  // ─── Toggle Handler ──────────────────────────────────────────────────────
  // Single tap toggles. Debounced. During close animation, taps are ignored.
  const handleCompanionTap = useCallback(() => {
    // Ignore if this was a drag, not a tap
    if (drag.totalMoved() > 5) return;

    // Debounce: ignore taps within TAP_DEBOUNCE_MS of the last state change
    const now = Date.now();
    if (now - lastStateChange.current < TAP_DEBOUNCE_MS) return;
    lastStateChange.current = now;

    // Ignore taps during close animation
    if (isAnimatingClose.current) return;

    setChatState((prev) => {
      switch (prev) {
        case "idle":
        case "history":
          // Open: restore from history (messages are already in useChat)
          return "open";
        case "open":
          // Close: save to history first, then animate close
          saveCurrentMessages(companionId, messages);
          archiveSession(companionId, messages);
          isAnimatingClose.current = true;
          return "closing";
        case "closing":
          // Already closing — ignore
          return "closing";
      }
    });
  }, [companionId, messages, drag]);

  // ─── Close handler (from X button or tap-outside) ────────────────────────
  const handleClose = useCallback(() => {
    const now = Date.now();
    if (now - lastStateChange.current < TAP_DEBOUNCE_MS) return;
    lastStateChange.current = now;
    if (isAnimatingClose.current) return;

    saveCurrentMessages(companionId, messages);
    archiveSession(companionId, messages);
    isAnimatingClose.current = true;
    setChatState("closing");
  }, [companionId, messages]);

  // ─── Animation end handler ───────────────────────────────────────────────
  const handleExitComplete = useCallback(() => {
    isAnimatingClose.current = false;
    setChatState((prev) => (prev === "closing" ? "history" : prev));
  }, []);

  // ─── New chat handler ────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    newChat();
    setRestoredMessages([]);
    saveCurrentMessages(companionId, []);
  }, [companionId, newChat]);

  // ─── Companion switch ────────────────────────────────────────────────────
  const switchCompanion = useCallback((id: CompanionId) => {
    // Save current conversation before switching
    saveCurrentMessages(companionId, messages);
    setCompanionId(id);
    savePrefs({ companionId: id });
    // Tell the main process which companion is active (for system prompt)
    try {
      window.quip.setCompanion(id);
    } catch {
      /* non-fatal — main may not be ready */
    }
    // Load the new companion's last conversation
    const restored = loadCurrentMessages(id);
    setRestoredMessages(restored);
    setChatState(restored.length > 0 ? "open" : "idle");
  }, [companionId, messages]);

  // ─── Keyboard shortcuts (wired after handlers are defined) ─────────────
  useKeyboardShortcuts({
    onToggleChat: handleCompanionTap,
    onCloseChat: handleClose,
    onOpenSettings: () => setSettingsOpen(true),
    onNewChat: handleNewChat,
    onSwitchCompanion: switchCompanion,
    isSettingsOpen: settingsOpen,
  });

  // ─── Track companion screen position (for panel transformOrigin) ──────
  const companionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const updatePos = () => {
      const el = companionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCompanionScreenPos({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    // Also update after drag ends
    const interval = setInterval(updatePos, 1000);
    return () => {
      window.removeEventListener("resize", updatePos);
      clearInterval(interval);
    };
  }, []);

  // ─── On mount: tell main which companion is active ──────────────────────
  useEffect(() => {
    try {
      window.quip.setCompanion(companionId);
    } catch {
      /* non-fatal */
    }
  }, [companionId]);

  // ─── Fetch companion mood (animation speed) + cosmetics ────────────────
  useEffect(() => {
    let active = true;
    const fetchMood = async () => {
      try {
        const mood = await window.quip.getCompanionMood(companionId);
        if (active && mood && typeof (mood as any).energy === "number") {
          setMoodSpeed(0.5 + (mood as any).energy);
        }
      } catch {
        /* non-fatal */
      }
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
      } catch {
        /* non-fatal */
      }
    };
    fetchMood();
    fetchCosmetics();
    const interval = setInterval(() => {
      fetchMood();
    }, 60_000); // refresh mood every minute
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [companionId]);

  // ─── Listen for cosmetic unlocks ────────────────────────────────────────
  useEffect(() => {
    const off = window.quip.onCosmeticUnlock((unlock: any) => {
      if (unlock && unlock.companion === companionId) {
        setUnlockToast(unlock.name);
        // Add to cosmetics list
        setCosmetics((prev) => [...prev, unlock.id]);
        // Clear toast after 4 seconds
        setTimeout(() => setUnlockToast(null), 4000);
        // Refresh full cosmetics list
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

  // ─── Persist messages on every change (debounced via useChat) ────────────
  useEffect(() => {
    if (chatState === "open" && messages.length > 0) {
      saveCurrentMessages(companionId, messages);
    }
  }, [messages, companionId, chatState]);

  // ─── Companion animation state ───────────────────────────────────────────
  const isResponding =
    chatBusy &&
    messages.some((m) => m.role === "assistant" && m.streaming && m.content.length > 0);
  const pixState: PixState = chatBusy
    ? isResponding
      ? "responding"
      : "thinking"
    : hovering
      ? "hover"
      : "idle";

  const theme = getCompanion(companionId);
  const showPanel = chatState === "open" || chatState === "closing";
  // During close animation, disable all pointer events inside the panel
  // to prevent accidental sends / clicks while it's animating away.
  const panelInteractive = chatState === "open";

  // Dynamic transform origin: panel grows FROM the companion sprite's
  // actual position on screen. Falls back to "bottom right" if unknown.
  const transformOrigin = companionScreenPos
    ? `${companionScreenPos.x}px ${companionScreenPos.y}px`
    : "bottom right";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        pointerEvents: "none",
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
            // Only close if the click was on this backdrop itself
            if (e.target === e.currentTarget) {
              handleClose();
            }
          }}
        />
      )}

      {/* ─── Chat PANEL — toggles on companion tap ─────────────────────── */}
      {/* Position from Spatial Brain — never overflows off-screen. */}
      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 120,
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        <AnimatePresence onExitComplete={handleExitComplete}>
          {showPanel && (
            <motion.div
              key="chat-panel"
              initial={{ opacity: 0, y: 24, scale: 0.92, transformOrigin }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                transition: {
                  type: "spring",
                  stiffness: 380,
                  damping: 32,
                  mass: 0.8,
                },
              }}
              exit={{
                opacity: 0,
                y: 16,
                scale: 0.94,
                transition: { duration: CLOSE_ANIMATION_MS / 1000, ease: [0.4, 0, 1, 1] },
              }}
              style={{
                pointerEvents: panelInteractive ? "auto" : "none",
                width: spatial?.chatPanel.width ?? 400,
                height: spatial?.chatPanel.height ?? 560,
                borderRadius: 18,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                background: "rgba(255,255,255,0.65)",
                backdropFilter: "blur(30px)",
                WebkitBackdropFilter: "blur(30px)",
                border: "1px solid rgba(255,255,255,0.5)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.03)",
              }}
            >
              <TopBar
                companionId={companionId}
                onCompanionChange={switchCompanion}
                onSettingsToggle={() => setSettingsOpen(true)}
                onNewChat={handleNewChat}
                onClose={handleClose}
              />

              {/* Error banner — with dismiss + retry hint */}
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
                {messages.length === 0 ? (
                  <ChatWelcome companionId={companionId} onSuggestionClick={send} />
                ) : (
                  <ChatLayout messages={messages} busy={chatBusy} />
                )}
              </div>

              {/* Input */}
              <ChatInput onSend={send} busy={chatBusy} companionId={companionId} />

              {/* Settings overlay (inside panel) */}
              <SettingsPanel
                open={settingsOpen}
                companionId={companionId}
                onCompanionChange={switchCompanion}
                onClose={() => setSettingsOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── COMPANION SPRITE — ALWAYS visible ─────────────────────────── */}
      <div
        ref={companionRef}
        role="button"
        aria-label={`${theme.name} companion — tap to ${showPanel ? "close" : "open"} chat. Keyboard: Cmd+K`}
        tabIndex={0}
        style={{
          position: "absolute",
          right: 30,
          bottom: 20,
          width: 72,
          height: 88,
          pointerEvents: "auto",
          cursor: "grab",
          transition: "filter 200ms",
          zIndex: 20,
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCompanionTap();
          }
        }}
        onPointerEnter={() => {
          setHovering(true);
          (document.activeElement as HTMLElement)?.blur?.();
        }}
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
          size={64}
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

      {/* Cosmetic unlock toast — celebratory feedback */}
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
              zIndex: 30,
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
