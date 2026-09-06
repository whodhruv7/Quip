// Quip — QuipSay bubble
// ─────────────────────────────────────────────────────────────────────────────
// A small companion speech bubble that floats above the Quip sprite on the
// user's screen — for proactive messages ("Hey, what's up?", "Drink some
// water"). Tapping it dismisses. Auto-hides after 12s. Calm, subtle, never
// blocks the pointer anywhere else on screen.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface QuipSayProps {
  message: string | null;
  companionColor: string;
  onDismiss: () => void;
  /** Compact layout for companion-only mode (tiny window) */
  compact?: boolean;
}

const AUTO_HIDE_MS = 12000;

export function QuipSay({ message, companionColor, onDismiss, compact }: QuipSayProps) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.button
          key={message}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.94 }}
          transition={{ type: "spring", stiffness: 400, damping: 26 }}
          onClick={onDismiss}
          aria-label={`Quip says: ${message}. Tap to dismiss.`}
          style={{
            position: "absolute",
            bottom: compact ? 118 : 108,
            right: compact ? 8 : 24,
            zIndex: 150,
            maxWidth: compact ? 118 : 220,
            padding: compact ? "7px 10px" : "9px 13px",
            borderRadius: "14px 14px 4px 14px",
            background: "rgba(255,255,255,0.96)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: `1px solid ${companionColor}33`,
            boxShadow: `0 8px 24px rgba(0,0,0,0.1), 0 0 0 3px ${companionColor}0a`,
            fontSize: compact ? 10 : 12,
            fontWeight: 500,
            color: "#10131f",
            lineHeight: 1.45,
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          {message}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
