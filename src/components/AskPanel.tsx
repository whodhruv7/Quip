// Quip V1 — Ask panel (premium glass chat).
//
// Features:
//   - Top bar with companion icon, QUIP logo, settings & close buttons
//   - Full-screen white chat area
//   - Clean input with ASK/ACT toggle and send
//   - Premium spacing, typography

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ChatMessage, CompanionId } from "@/types";
import { COMPANIONS } from "./Companion";
import { ChatMessageView } from "./ChatMessage";
import { ChatInput } from "./ChatInput";

interface AskPanelProps {
  open: boolean;
  companionId: CompanionId;
  onCompanionChange: (id: CompanionId) => void;
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onAct: (command: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function AskPanel({
  open,
  companionId,
  onCompanionChange,
  messages,
  busy,
  error,
  onSend,
  onAct,
  onClear,
  onClose,
}: AskPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  const theme = COMPANIONS.find((c) => c.id === companionId)!;

  // Auto-scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col overflow-hidden rounded-3xl border border-black/10 shadow-2xl"
      style={{
        pointerEvents: "auto",
        width: 520,
        height: 640,
        background: "#FFFFFF",
      }}
    >
      {/* ---------- HEADER ---------- */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{
          borderBottom: "1px solid rgba(0,0,0,0.06)",
          background: "#FFFFFF",
        }}
      >
        {/* Current companion icon */}
        <div
          className="flex h-8 w-8 items-center justify-center rounded-xl"
          style={{
            background: `linear-gradient(135deg, ${theme.primary}22, ${theme.secondary}22)`,
          }}
        >
          <span className="text-lg">✦</span>
        </div>

        {/* QUIP logo */}
        <div className="flex-1 text-center">
          <span className="text-[14px] font-semibold tracking-wide text-quip-ink">
            QUIP
          </span>
        </div>

        {/* Settings button */}
        <button
          onClick={() => setShowSettings(true)}
          title="Settings"
          className="rounded-lg p-2 text-quip-gray transition-colors hover:bg-black/[0.04] hover:text-quip-ink"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>

        {/* Close button */}
        <button
          onClick={onClose}
          title="Close"
          className="rounded-lg p-2 text-quip-gray transition-colors hover:bg-black/[0.04] hover:text-quip-ink"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* ---------- SETTINGS POPUP ---------- */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-20 flex flex-col rounded-3xl bg-white"
          >
            <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
              <h3 className="text-[15px] font-semibold text-quip-ink">Settings</h3>
              <div className="flex-1" />
              <button
                onClick={() => setShowSettings(false)}
                className="rounded-lg p-1 text-quip-gray transition-colors hover:bg-black/[0.04]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {/* Switch Companion */}
              <div className="mb-6">
                <h4 className="mb-3 text-[13px] font-medium text-quip-gray uppercase tracking-wide">
                  Companion
                </h4>
                <div className="flex flex-col gap-2">
                  {COMPANIONS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        onCompanionChange(c.id);
                        setShowSettings(false);
                      }}
                      className="flex items-center gap-3 rounded-xl border border-black/5 px-4 py-3 text-left transition-all hover:border-black/10 hover:bg-black/[0.02]"
                      style={{
                        borderColor: companionId === c.id ? c.primary + "44" : undefined,
                        background: companionId === c.id ? `${c.primary}08` : undefined,
                      }}
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ background: c.primary }}
                      />
                      <div>
                        <p className="text-[14px] font-medium text-quip-ink">{c.name}</p>
                        <p className="text-[11px] text-quip-gray">{c.subtitle}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Models */}
              <div className="mb-6">
                <h4 className="mb-3 text-[13px] font-medium text-quip-gray uppercase tracking-wide">
                  Model
                </h4>
                <div className="rounded-xl border border-black/5 bg-black/[0.02] px-4 py-3">
                  <p className="text-[13px] text-quip-gray">
                    Using Groq fallback model (llama-3.3-70b-versatile)
                  </p>
                  <p className="mt-1 text-[11px] text-quip-gray/70">
                    OpenRouter unavailable. Automatic fallback active.
                  </p>
                </div>
              </div>

              {/* Theme */}
              <div className="mb-6">
                <h4 className="mb-3 text-[13px] font-medium text-quip-gray uppercase tracking-wide">
                  Theme
                </h4>
                <div className="rounded-xl border border-black/5 bg-black/[0.02] px-4 py-3">
                  <p className="text-[13px] text-quip-gray">Light (Default)</p>
                  <p className="mt-1 text-[11px] text-quip-gray/70">More themes coming soon</p>
                </div>
              </div>

              {/* About */}
              <div>
                <h4 className="mb-3 text-[13px] font-medium text-quip-gray uppercase tracking-wide">
                  About
                </h4>
                <div className="rounded-xl border border-black/5 bg-black/[0.02] px-4 py-3">
                  <p className="text-[13px] font-medium text-quip-ink">QUIP v0.1</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-quip-gray">
                    Your AI Life Companion. Beautiful, premium, calm, and alive.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- CHAT AREA ---------- */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
        >
          {messages.length === 0 ? (
            <div className="m-auto flex flex-col items-center gap-4 px-8 text-center">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{
                  background: `linear-gradient(135deg, ${theme.primary}18, ${theme.secondary}14)`,
                }}
              >
                <span className="text-3xl">✦</span>
              </div>
              <div>
                <p className="text-[16px] font-semibold text-quip-ink">
                  Hey 👋
                </p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-quip-gray">
                  I'm {theme.name}.
                </p>
                <p className="mt-1 text-[14px] leading-relaxed text-quip-gray">
                  What would you like to do today?
                </p>
              </div>
            </div>
          ) : (
            messages.map((m) => <ChatMessageView key={m.id} message={m} />)
          )}
        </div>

        {/* Error banner */}
        {error && !busy && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-center text-[12px] text-red-500">
            ⚠ {error}
          </div>
        )}

        {/* Input */}
        <ChatInput onSend={onSend} onAct={onAct} busy={busy} themeColor={theme.primary} />
      </div>
    </motion.div>
  );
}
