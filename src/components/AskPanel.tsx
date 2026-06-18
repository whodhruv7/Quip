// Quip V0.1 — Ask panel (premium glass chat).
//
// Features:
//   - Companion switcher (Pix / Kai / Ren) in the header
//   - Scrollable chat with markdown + code blocks
//   - Chat history sidebar (past sessions viewable after clear)
//   - Clean input with send
//   - Premium glass, spacing, typography

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ChatMessage, CompanionId, ChatSession } from "@/types";
import { COMPANIONS } from "./Companion";
import { ChatMessageView } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { loadSessions } from "@/lib/storage";

interface AskPanelProps {
  open: boolean;
  companionId: CompanionId;
  onCompanionChange: (id: CompanionId) => void;
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onClear: () => void;
}

export function AskPanel({
  open,
  companionId,
  onCompanionChange,
  messages,
  busy,
  error,
  onSend,
  onClear,
}: AskPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  const theme = COMPANIONS.find((c) => c.id === companionId)!;

  // Auto-scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  // Load sessions when history panel opens.
  useEffect(() => {
    if (showHistory) setSessions(loadSessions());
  }, [showHistory]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="flex overflow-hidden rounded-3xl border border-white/50 shadow-glass backdrop-blur-2xl"
      style={{
        pointerEvents: "auto",
        width: 440,
        height: 520,
        background: "rgba(255,255,255,0.62)",
      }}
    >
      {/* ---------- HEADER ---------- */}
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{
          borderBottom: "1px solid rgba(0,0,0,0.05)",
          background: "rgba(255,255,255,0.50)",
        }}
      >
        {/* Companion switcher pills */}
        <div className="flex items-center gap-1.5">
          {COMPANIONS.map((c) => (
            <button
              key={c.id}
              onClick={() => onCompanionChange(c.id)}
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] font-medium transition-all"
              style={{
                background:
                  companionId === c.id
                    ? `linear-gradient(135deg, ${c.primary}22, ${c.secondary}22)`
                    : "transparent",
                color:
                  companionId === c.id ? c.primary : "#7A7A7A",
                border: `1px solid ${companionId === c.id ? c.primary + "44" : "transparent"}`,
                boxShadow:
                  companionId === c.id
                    ? `0 2px 8px ${c.primary}22`
                    : "none",
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: c.primary }}
              />
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* History button */}
        <button
          onClick={() => setShowHistory((p) => !p)}
          title="Chat history"
          className="rounded-lg p-1.5 text-quip-gray transition-colors hover:bg-black/[0.04] hover:text-quip-ink"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
        </button>

        {/* Clear button */}
        {messages.length > 0 && (
          <button
            onClick={onClear}
            title="Clear chat"
            className="rounded-lg p-1.5 text-quip-gray transition-colors hover:bg-black/[0.04] hover:text-quip-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        )}
      </div>

      {/* ---------- HISTORY SIDEBAR (overlay) ---------- */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 z-20 flex flex-col rounded-3xl border border-white/50 backdrop-blur-xl"
            style={{ background: "rgba(255,255,255,0.92)" }}
          >
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
              <h3 className="text-[14px] font-semibold text-quip-ink">History</h3>
              <div className="flex-1" />
              <button
                onClick={() => setShowHistory(false)}
                className="rounded-lg p-1 text-quip-gray transition-colors hover:bg-black/[0.04]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {sessions.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-quip-gray">
                  No past conversations yet.
                </p>
              ) : (
                sessions.map((s) => {
                  const sc = COMPANIONS.find((c) => c.id === s.companionId);
                  const time = new Date(s.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <div
                      key={s.id}
                      className="mb-2 rounded-2xl border border-black/[0.04] bg-white/70 p-3 transition-colors hover:bg-white/90"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: sc?.primary || "#6FD6FF" }}
                        />
                        <span className="text-[12px] font-medium text-quip-ink">
                          {sc?.name || "Unknown"}
                        </span>
                        <span className="text-[11px] text-quip-gray">
                          {time}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] text-quip-gray line-clamp-2">
                        {s.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-quip-gray/70">
                        {s.messages.length} messages
                      </p>
                      {/* Show all messages in expandable detail */}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-quip-gray hover:text-quip-ink">
                          View messages
                        </summary>
                        <div className="mt-2 max-h-60 overflow-y-auto rounded-xl bg-black/[0.02] p-2 text-[12px] leading-relaxed text-quip-ink quip-md">
                          {s.messages.map((m, i) => (
                            <div key={i} className="mb-1.5">
                              <span
                                className="font-medium"
                                style={{ color: m.role === "user" ? theme.primary : "#7A7A7A" }}
                              >
                                {m.role === "user" ? "You" : sc?.name}:
                              </span>{" "}
                              <span className="quip-inline">{m.content.slice(0, 200)}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- CHAT AREA ---------- */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Status bar */}
        <div
          className="flex items-center gap-2 px-4 py-1.5"
          style={{
            borderBottom: "1px solid rgba(0,0,0,0.03)",
            background: `linear-gradient(90deg, ${theme.primary}08, ${theme.secondary}06)`,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: busy ? theme.primary : "#34D399",
              boxShadow: busy ? `0 0 6px ${theme.primary}` : "0 0 6px #34D399",
            }}
          />
          <span className="text-[11px] text-quip-gray">
            {busy
              ? `${theme.name} is thinking…`
              : theme.subtitle}
          </span>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3"
        >
          {messages.length === 0 ? (
            <div className="m-auto flex flex-col items-center gap-3 px-8 text-center">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl"
                style={{
                  background: `linear-gradient(135deg, ${theme.primary}18, ${theme.secondary}14)`,
                }}
              >
                <span className="text-2xl">✦</span>
              </div>
              <div>
                <p className="text-[15px] font-semibold text-quip-ink">
                  Hi, I'm {theme.name}.
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-quip-gray">
                  {companionId === "pix" &&
                    "Your creative companion. Ask me anything — ideas, captions, messages, or just chat."}
                  {companionId === "kai" &&
                    "Your wise guide. I'll help you think clearly — research, plans, concepts, learning."}
                  {companionId === "ren" &&
                    "Your memory keeper. I'm here to listen — feelings, reflections, personal thoughts."}
                </p>
              </div>
            </div>
          ) : (
            messages.map((m) => <ChatMessageView key={m.id} message={m} />)
          )}
        </div>

        {/* Error banner */}
        {error && !busy && (
          <div className="border-t border-red-100 bg-red-50/80 px-4 py-2 text-center text-[12px] text-red-500">
            ⚠ {error}
          </div>
        )}

        {/* Input */}
        <ChatInput onSend={onSend} busy={busy} themeColor={theme.primary} />
      </div>
    </motion.div>
  );
}
