// Quip History Drawer — every past conversation, one tap away
// ─────────────────────────────────────────────────────────────────────────────
// Opens from the TopBar's history button. Lists archived sessions for the
// current companion (newest first); tapping one loads it back into the chat
// view exactly as it was. "New chat" archives the current one and starts
// fresh. Sessions are capped (oldest evicted) by the storage layer.
// ─────────────────────────────────────────────────────────────────────────────

import { AnimatePresence, motion } from "framer-motion";
import type { ChatSession } from "@/types";

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Today";
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface HistoryDrawerProps {
  open: boolean;
  sessions: ChatSession[];
  companionId: string;
  onClose: () => void;
  onOpenSession: (session: ChatSession) => void;
  onNewChat: () => void;
}

export function HistoryDrawer({ open, sessions, companionId, onClose, onOpenSession, onNewChat }: HistoryDrawerProps) {
  const mine = sessions.filter((s) => s.companionId === companionId);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.32)",
              zIndex: 380,
            }}
          />
          <motion.div
            key="drawer"
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            style={{
              position: "fixed",
              top: 10,
              right: 10,
              bottom: 10,
              width: 264,
              zIndex: 390,
              background: "rgb(var(--chrome-bg) / 0.97)",
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
              border: "1px solid rgba(var(--quip-line), 0.18)",
              borderRadius: 16,
              boxShadow: "0 18px 50px rgba(0,0,0,0.3)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            role="dialog"
            aria-label="Chat history"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px 8px",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "rgb(var(--chrome-text))" }}>
                History
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close history"
                className="quip-focusable"
                style={{
                  fontSize: 12,
                  color: "rgb(var(--chrome-soft))",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 2,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
              {mine.length === 0 && (
                <div style={{ fontSize: 11.5, color: "rgb(var(--chrome-soft))", padding: "10px 6px", lineHeight: 1.5 }}>
                  No saved chats yet. When you start a new chat, the current one is archived here automatically.
                </div>
              )}
              {mine.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onOpenSession(s);
                    onClose();
                  }}
                  className="quip-focusable"
                  style={{
                    textAlign: "left",
                    borderRadius: 10,
                    border: "1px solid rgba(var(--quip-line), 0.14)",
                    background: "rgba(var(--quip-line), 0.05)",
                    padding: "8px 10px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "rgb(var(--chrome-text))",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.title || "Untitled chat"}
                  </span>
                  <span style={{ fontSize: 10.5, color: "rgb(var(--chrome-soft))" }}>
                    {dayLabel(s.updatedAt)} · {timeLabel(s.updatedAt)} · {s.messages.length} message{s.messages.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>

            <div style={{ padding: "10px 12px 12px", borderTop: "1px solid rgba(var(--quip-line), 0.12)" }}>
              <button
                type="button"
                onClick={() => {
                  onNewChat();
                  onClose();
                }}
                className="quip-focusable"
                style={{
                  width: "100%",
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: "rgb(var(--quip-accent-deep))",
                  background: "rgba(var(--quip-accent), 0.12)",
                  border: "1px solid rgba(var(--quip-accent), 0.35)",
                  borderRadius: 10,
                  padding: "7px 10px",
                  cursor: "pointer",
                }}
              >
                ✦ New chat (archive this one)
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
