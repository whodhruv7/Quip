// Quip V2 — application root.
//
// THREE WINDOW MODES (mirrored in the Electron main process):
//
//   companion — Quip boots as a small desktop companion. ONLY the selected
//               companion sprite is on screen, floating calmly, draggable.
//   panel     — tap the companion: a small panel opens BESIDE it (left),
//               with a square expand button in the top bar.
//   full      — the square expand button opens the full Quip app: a calm
//               two-column layout (companion stage + chat) in Quip's theme.
//
// Closing the panel or the full app always returns to the single companion.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Companion } from "@/components/Companion";
import { TopBar } from "@/components/TopBar";
import { ChatLayout } from "@/components/ChatLayout";
import { ChatWelcome } from "@/components/ChatWelcome";
import { ChatInput } from "@/components/ChatInput";
import { ScanOverlay } from "@/components/ScanOverlay";
import { SettingsPanel } from "@/components/SettingsPanel";
import { WeeklyReflection } from "@/components/WeeklyReflection";
import { ActionApprovalPanel } from "@/components/ActionApprovalPanel";
import { QuipSay } from "@/components/QuipSay";
import { useChat } from "@/hooks/useChat";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import {
  loadPrefs,
  savePrefs,
  loadCurrentMessages,
  saveCurrentMessages,
} from "@/lib/storage";
import { getCompanion } from "@/lib/companion-config";
import type { WindowMode } from "../electron/shared";
import type {
  ChatMessage,
  CompanionId,
  PixState,
} from "@/types";

// ─── Layout constants ───────────────────────────────────────────────────────
const COMPANION_SIZE = 72;          // sprite size in companion/panel modes
const STAGE_COMPANION_SIZE = 168;   // sprite size in the full app stage
const PANEL_GAP = 8;                // gap between panel card and companion
const PANEL_MARGIN = 12;

export default function App() {
  const [companionId, setCompanionId] = useState<CompanionId>(() => loadPrefs().companionId);
  const [viewMode, setViewMode] = useState<WindowMode>("companion");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [scanDone, setScanDone] = useState(() => loadPrefs().scanned ?? false);
  const [hovering, setHovering] = useState(false);
  const [moodSpeed, setMoodSpeed] = useState(1);
  const [cosmetics, setCosmetics] = useState<string[]>([]);
  const [unlockToast, setUnlockToast] = useState<string | null>(null);

  const [restoredMessages, setRestoredMessages] = useState<ChatMessage[]>(() =>
    loadCurrentMessages(companionId)
  );
  const [quipSay, setQuipSay] = useState<string | null>(null);

  const { messages, busy: chatBusy, error, send, newChat, clearError, approvalRequest, resolveApproval, taskProgress } =
    useChat(companionId, restoredMessages);

  // ─── Window mode sync (renderer state ↔ Electron window) ────────────────
  useEffect(() => {
    let alive = true;
    try {
      window.quip
        .getWindowMode()
        .then((m) => { if (alive) setViewMode(m); })
        .catch(() => {});
    } catch {
      /* non-fatal */
    }
    const off = window.quip.onWindowModeChanged((m) => {
      if (alive) setViewMode(m);
    });
    return () => { alive = false; off(); };
  }, []);

  const enterMode = useCallback((mode: WindowMode) => {
    setViewMode(mode);
    try {
      window.quip.setWindowMode(mode);
    } catch {
      /* non-fatal — renderer still switches layout */
    }
  }, []);

  // ─── Tap the companion: companion ⇄ panel ──────────────────────────────
  const drag = useWindowDrag(viewMode !== "full");
  const lastTap = useRef(0);

  const handleCompanionTap = useCallback(() => {
    if (drag.totalMoved() > 5) return; // it was a drag, not a tap
    const now = Date.now();
    if (now - lastTap.current < 150) return;
    lastTap.current = now;
    enterMode(viewMode === "companion" ? "panel" : "companion");
  }, [drag, enterMode, viewMode]);

  // ─── Approval requests must be VISIBLE ──────────────────────────────────
  // If a task needs confirmation while Quip is in companion-only mode, open
  // the panel so the user can actually see and answer it (otherwise the
  // request would time out unanswered).
  useEffect(() => {
    if (approvalRequest && viewMode === "companion") {
      enterMode("panel");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalRequest]);

  // ─── First run: open the panel so the scan overlay has room ────────────
  useEffect(() => {
    if (!scanDone) enterMode("panel");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Close (X) — always returns to the single desktop companion ────────
  const handleClose = useCallback(() => {
    saveCurrentMessages(companionId, messages);
    setSettingsOpen(false);
    setReflectionOpen(false);
    enterMode("companion");
  }, [companionId, messages, enterMode]);

  // ─── New chat ────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    newChat();
    setRestoredMessages([]);
    saveCurrentMessages(companionId, []);
  }, [companionId, newChat]);

  // ─── Switch companion ────────────────────────────────────────────────────
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

  // ─── On mount: tell main which companion is active ──────────────────────
  useEffect(() => {
    try {
      window.quip.setCompanion(companionId);
    } catch {
      /* non-fatal */
    }
  }, [companionId]);

  // ─── Fetch mood + cosmetics ─────────────────────────────────────────────
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

  // ─── Listen for cosmetic unlocks ─────────────────────────────────────────
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

  // ─── QuipSay: newest proactive message floats as an on-screen bubble ────
  const latestProactive = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.proactive) return m.content;
      if (i < messages.length - 3) break; // only look at recent tail
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (latestProactive) setQuipSay(latestProactive);
  }, [latestProactive]);

  // ─── Shared chat body (used by both panel and full layouts) ──────────────
  const chatBody = (
    <>
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

      {/* Live task progress — step x/y with what is actually running */}
      <AnimatePresence>
        {taskProgress && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            style={{
              margin: "0 12px 6px",
              padding: "7px 12px",
              borderRadius: 12,
              background: `${theme.primary}0f`,
              border: `1px solid ${theme.primary}2e`,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11.5,
              color: "#374151",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: theme.primary,
                flexShrink: 0,
                animation: "quipPulse 1.2s ease-in-out infinite",
              }}
            />
            <span style={{ fontWeight: 600, color: theme.primary, flexShrink: 0 }}>
              Step {taskProgress.step}/{taskProgress.total}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {taskProgress.description}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {approvalRequest && (
          <ActionApprovalPanel
            request={approvalRequest}
            companionColor={theme.primary}
            onResolve={resolveApproval}
          />
        )}
      </AnimatePresence>

      <ChatInput onSend={send} busy={chatBusy} companionId={companionId} />
    </>
  );

  const topBar = (
    <TopBar
      companionId={companionId}
      onCompanionChange={switchCompanion}
      onSettingsToggle={() => setSettingsOpen(true)}
      onReflectionToggle={() => setReflectionOpen(true)}
      onNewChat={handleNewChat}
      onClose={handleClose}
      mode={viewMode === "full" ? "full" : "panel"}
      onToggleExpand={() => enterMode(viewMode === "full" ? "panel" : "full")}
    />
  );

  const overlays = (
    <>
      <SettingsPanel
        open={settingsOpen}
        companionId={companionId}
        onCompanionChange={switchCompanion}
        onClose={() => setSettingsOpen(false)}
      />
      <AnimatePresence>
        {reflectionOpen && (
          <WeeklyReflection
            companionId={companionId}
            onClose={() => setReflectionOpen(false)}
          />
        )}
      </AnimatePresence>
      {!scanDone && viewMode !== "companion" && (
        <ScanOverlay
          companionId={companionId}
          onDone={() => {
            setScanDone(true);
            savePrefs({ scanned: true });
          }}
        />
      )}
    </>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        pointerEvents: "none",
      }}
    >
      {/* ═══ COMPANION MODE — only the sprite, floating calmly ═══════════ */}
      {viewMode === "companion" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            padding: "8px 10px 10px 8px",
          }}
        >
          <div
            role="button"
            aria-label={`${theme.name} companion — tap to open Quip`}
            tabIndex={0}
            style={{
              position: "relative",
              width: COMPANION_SIZE + 8,
              height: COMPANION_SIZE + 16,
              pointerEvents: "auto",
              cursor: "grab",
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
          </div>

          {/* Compact proactive bubble above the companion */}
          <QuipSay
            message={quipSay}
            companionColor={theme.primary}
            onDismiss={() => setQuipSay(null)}
            compact
          />
        </div>
      )}

      {/* ═══ PANEL MODE — small panel beside the companion ═══════════════ */}
      {viewMode === "panel" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "stretch",
            gap: PANEL_GAP,
            padding: PANEL_MARGIN,
          }}
        >
          {/* Small panel — left side */}
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, x: -16, scale: 0.98 }}
            animate={{
              opacity: 1,
              x: 0,
              scale: 1,
              transition: { type: "spring", stiffness: 380, damping: 30, mass: 0.7 },
            }}
            style={{
              pointerEvents: "auto",
              flex: 1,
              minWidth: 0,
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
            {topBar}
            {chatBody}
            {overlays}
          </motion.div>

          {/* Companion docked at the bottom-right, always visible */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              alignItems: "center",
              width: COMPANION_SIZE + 20,
              flexShrink: 0,
              paddingBottom: 2,
            }}
          >
            <div
              role="button"
              aria-label={`${theme.name} — tap to collapse Quip`}
              tabIndex={0}
              style={{
                position: "relative",
                width: COMPANION_SIZE + 8,
                height: COMPANION_SIZE + 16,
                pointerEvents: "auto",
                cursor: "grab",
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
            </div>
          </div>
        </div>
      )}

      {/* ═══ FULL MODE — the full Quip app ════════════════════════════════ */}
      {viewMode === "full" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            padding: 14,
          }}
        >
          <motion.div
            key="full-app"
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { type: "spring", stiffness: 320, damping: 30, mass: 0.8 },
            }}
            style={{
              pointerEvents: "auto",
              height: "100%",
              borderRadius: 24,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              background: "rgba(252,252,253,0.88)",
              backdropFilter: "blur(30px) saturate(180%)",
              WebkitBackdropFilter: "blur(30px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.65)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.03)",
            }}
          >
            {topBar}

            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
              {/* Companion stage — calm, roomy */}
              <div
                style={{
                  width: 300,
                  flexShrink: 0,
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  background:
                    `radial-gradient(circle at 50% 30%, ${theme.auraA} 0%, transparent 70%)`,
                  borderRight: "1px solid rgba(0,0,0,0.035)",
                }}
              >
                <Companion
                  id={companionId}
                  state={pixState}
                  size={STAGE_COMPANION_SIZE}
                  unlockedCosmetics={cosmetics}
                  moodSpeed={moodSpeed}
                />
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: "#10131f",
                      letterSpacing: -0.2,
                    }}
                  >
                    {theme.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    {theme.subtitle}
                  </div>
                </div>
                {chatBusy && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: theme.primary,
                      background: "rgba(255,255,255,0.9)",
                      padding: "3px 10px",
                      borderRadius: 10,
                      border: `1px solid ${theme.primary}25`,
                    }}
                  >
                    {isResponding ? "typing…" : "thinking…"}
                  </motion.div>
                )}
                <QuipSay
                  message={quipSay}
                  companionColor={theme.primary}
                  onDismiss={() => setQuipSay(null)}
                />
              </div>

              {/* Chat column */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {chatBody}
              </div>
            </div>

            {overlays}
          </motion.div>
        </div>
      )}

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
