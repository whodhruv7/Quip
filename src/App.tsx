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

  // Restore messages from storage on mount (history persistence)
  const [restoredMessages, setRestoredMessages] = useState<ChatMessage[]>(() =>
    loadCurrentMessages(companionId)
  );

  const { messages, busy: chatBusy, error, send, newChat } = useChat(companionId, restoredMessages);
  const drag = useWindowDrag(true);

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

  // ─── On mount: tell main which companion is active ──────────────────────
  useEffect(() => {
    try {
      window.quip.setCompanion(companionId);
    } catch {
      /* non-fatal */
    }
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
              initial={{ opacity: 0, y: 20, scale: 0.96, transformOrigin: "bottom right" }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{
                opacity: 0,
                y: 20,
                scale: 0.96,
                transition: { duration: CLOSE_ANIMATION_MS / 1000, ease: "easeIn" },
              }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              style={{
                pointerEvents: "auto",
                width: 400,
                height: 560,
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

              {/* Error banner */}
              {error && (
                <div
                  style={{
                    padding: "6px 12px",
                    fontSize: 11,
                    color: "#dc2626",
                    background: "rgba(254,235,235,0.7)",
                    borderBottom: "1px solid rgba(239,68,68,0.12)",
                  }}
                >
                  {error}
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
        <Companion id={companionId} state={pixState} size={64} />

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
    </div>
  );
}
