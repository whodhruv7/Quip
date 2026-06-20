// Quip V2 — application root.
//
// Layout: Companion is ALWAYS visible (bottom-right, floating, draggable).
// The chat PANEL toggles open/closed on companion tap. Tap = show, tap = hide.
// Settings panel slides over everything when opened.

import { useEffect, useRef, useState } from "react";
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
import { loadPrefs, savePrefs } from "@/lib/storage";
import { getCompanion } from "@/lib/companion-config";
import type { CompanionId, PixState } from "@/types";

export default function App() {
  const [companionId, setCompanionId] = useState<CompanionId>(() => loadPrefs().companionId);
  const [panelOpen, setPanelOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [hovering, setHovering] = useState(false);

  const { messages, busy: chatBusy, error, send, newChat } = useChat(companionId);

  const drag = useWindowDrag(true);
  const lastClick = useRef(0);

  const handleCompanionClick = () => {
    if (drag.totalMoved() > 5) return;
    const now = Date.now();
    // Double-click hides the panel fast; single toggles.
    if (now - lastClick.current < 340) {
      setPanelOpen(false);
    } else {
      setPanelOpen((o) => !o);
    }
    lastClick.current = now;
  };

  const switchCompanion = (id: CompanionId) => {
    setCompanionId(id);
    savePrefs({ companionId: id });
    setPanelOpen(true);
  };

  // Determine companion state for animation.
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

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        pointerEvents: "none",
      }}
    >
      {/* ─── Chat PANEL — toggles on companion tap ─────────────────────── */}
      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 120, // above the companion sprite
          pointerEvents: "none",
        }}
      >
        <AnimatePresence>
          {panelOpen && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
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
                onNewChat={newChat}
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
          handleCompanionClick();
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
          {!panelOpen && !chatBusy && (
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
