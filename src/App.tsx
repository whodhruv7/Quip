// Quip V2 — application root.
//
// SIMPLE LAYOUT:
//   - Companion sprite: bottom-right corner, ALWAYS visible (zIndex 100)
//   - Chat panel: floats ABOVE the companion (gap between them), toggles on tap
//   - Tap companion = open chat. Tap again = close chat. Fast. Simple.
//   - No tap-outside catcher (was causing companion tap issues)
//   - X button in chat closes it too
//
// The companion is NEVER hidden by the chat panel — they're stacked vertically.

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
import {
  loadPrefs,
  savePrefs,
  loadCurrentMessages,
  saveCurrentMessages,
} from "@/lib/storage";
import { getCompanion } from "@/lib/companion-config";
import type { ChatMessage, CompanionId, PixState } from "@/types";

// ─── Layout constants ───────────────────────────────────────────────────────
const COMPANION_SIZE = 72;
const COMPANION_MARGIN = 24;
const PANEL_GAP = 12;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 520;

type ChatState = "closed" | "open";

export default function App() {
  const [companionId, setCompanionId] = useState<CompanionId>(() => loadPrefs().companionId);
  const [chatState, setChatState] = useState<ChatState>("closed");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [moodSpeed, setMoodSpeed] = useState(1);
  const [cosmetics, setCosmetics] = useState<string[]>([]);
  const [unlockToast, setUnlockToast] = useState<string | null>(null);
  const [restoredMessages, setRestoredMessages] = useState<ChatMessage[]>(() =>
    loadCurrentMessages(companionId)
  );

  const { messages, busy: chatBusy, error, send, newChat, clearError } = useChat(companionId, restoredMessages);
  const drag = useWindowDrag(true);
  const lastTap = useRef(0);

  const handleCompanionTap = useCallback(() => {
    if (drag.totalMoved() > 5) return;
    const now = Date.now();
    if (now - lastTap.current < 150) return;
    lastTap.current = now;
    setChatState((prev) => (prev === "open" ? "closed" : "open"));
  }, [drag]);

  const handleClose = useCallback(() => {
    setChatState("closed");
    saveCurrentMessages(companionId, messages);
  }, [companionId, messages]);

  const handleNewChat = useCallback(() => {
    newChat();
    setRestoredMessages([]);
    saveCurrentMessages(companionId, []);
  }, [companionId, newChat]);

  const switchCompanion = useCallback((id: CompanionId) => {
    saveCurrentMessages(companionId, messages);
    setCompanionId(id);
    savePrefs({ companionId: id });
    try {
      window.quip.setCompanion(id);
    } catch {
      /* non-fatal */
    }
    const restored = loadCurrentMessages(id);
    setRestoredMessages(restored);
  }, [companionId, messages]);

  useEffect(() => {
    try {
      window.quip.setCompanion(companionId);
    } catch {
      /* non-fatal */
    }
  }, [companionId]);

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
    const interval = setInterval(fetchMood, 60_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [companionId]);

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
  const showPanel = chatState === "open";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        pointerEvents: "none",
      }}
    >
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
                transition: { type: "spring", stiffness: 400, damping: 30, mass: 0.7 },
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
              <TopBar
                companionId={companionId}
                onCompanionChange={switchCompanion}
                onSettingsToggle={() => setSettingsOpen(true)}
                onNewChat={handleNewChat}
                onClose={handleClose}
              />

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

              <div className="relative flex flex-1 flex-col overflow-hidden">
                {messages.length === 0 ? (
                  <ChatWelcome companionId={companionId} onSuggestionClick={send} />
                ) : (
                  <ChatLayout messages={messages} busy={chatBusy} />
                )}
              </div>

              <ChatInput onSend={send} busy={chatBusy} companionId={companionId} />

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
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCompanionTap();
          }
        }}
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
          unlockedCosmetics={cosmetics}
          moodSpeed={moodSpeed}
        />

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

      {!scanDone && <ScanOverlay companionId={companionId} onDone={() => setScanDone(true)} />}

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
              zIndex: 200,
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
              <span style={{ fontSize: 11, fontWeight: 600, color: "#111" }}>New unlock!</span>
              <span style={{ fontSize: 11, color: "#6b7280" }}>{unlockToast}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
