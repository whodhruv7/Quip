// Quip V2 — Welcome screen.
//
// Shows when there are no messages yet. Companion greeting + quick suggestions.
// Premium, minimal, Apple × Arc × Linear style.

import { motion } from "framer-motion";
import type { CompanionId } from "@/types";
import { getCompanion } from "@/lib/companion-config";
import { CHAT_SUGGESTIONS } from "@/lib/constants";

interface ChatWelcomeProps {
  companionId: CompanionId;
  onSuggestionClick: (text: string) => void;
}

// Removed inline SUGGESTIONS

export function ChatWelcome({ companionId, onSuggestionClick }: ChatWelcomeProps) {
  const theme = getCompanion(companionId);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
      {/* Companion glow */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mb-4"
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: `linear-gradient(135deg, ${theme.primary}20, ${theme.secondary}15)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 8px 32px ${theme.primary}15`,
          border: `1px solid ${theme.primary}18`,
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
          }}
        />
      </motion.div>

      {/* Greeting */}
      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "#111",
          marginBottom: 4,
          textAlign: "center",
        }}
      >
        Hey, I'm {theme.name}
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25 }}
        style={{
          fontSize: 13,
          color: "#9ca3af",
          marginBottom: 28,
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        {theme.subtitle}. Ask me anything or tell me what to do.
      </motion.p>

      {/* Quick suggestions */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.35 }}
        className="grid grid-cols-2 gap-2 w-full max-w-[280px]"
      >
        {CHAT_SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            onClick={() => onSuggestionClick(s.text)}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#374151",
              background: "rgba(255,255,255,0.70)",
              border: "1px solid rgba(0,0,0,0.05)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </motion.div>
    </div>
  );
}
