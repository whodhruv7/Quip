// Quip — QuipSay bubble
// ─────────────────────────────────────────────────────────────────────────────
// A small companion speech bubble that floats above the Quip sprite on the
// user's screen — for proactive messages ("Hey, what's up?", "Drink some
// water"). Tapping it dismisses. Auto-hides after 12s. Calm, subtle, never
// blocks the pointer anywhere else on screen.
//
// UX-050: bubble style is user-selectable via localStorage "quip.bubbleStyle":
//   "glass"   (default) translucent blur — backdropFilter + faint line bg
//   "solid"   opaque themed panel
//   "outline" transparent with a 1.5px accent border
// (Settings (A2) writes the key; missing/invalid → glass.)
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface QuipSayProps {
  message: string | null;
  companionColor: string;
  onDismiss: () => void;
  /** Compact layout for companion-only mode (tiny window) */
  compact?: boolean;
}

const AUTO_HIDE_MS = 12000;

type BubbleStyle = "glass" | "solid" | "outline";

function readBubbleStyle(): BubbleStyle {
  try {
    const raw = localStorage.getItem("quip.bubbleStyle");
    if (raw === "solid" || raw === "outline") return raw;
  } catch {
    /* default below */
  }
  return "glass";
}

export function QuipSay({ message, companionColor, onDismiss, compact }: QuipSayProps) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  // Re-read on every new bubble so a Settings change applies instantly.
  const bubbleStyle = useMemo(() => readBubbleStyle(), [message]);

  const surface: React.CSSProperties =
    bubbleStyle === "solid"
      ? {
          background: "rgb(var(--quip-bg))",
          border: `1px solid ${companionColor}33`,
        }
      : bubbleStyle === "outline"
        ? {
            background: "transparent",
            border: "1.5px solid rgb(var(--quip-accent))",
          }
        : {
            // glass — translucent blur
            background: "rgba(var(--quip-line), 0.09)",
            border: `1px solid ${companionColor}33`,
            backdropFilter: "blur(14px) saturate(150%)",
            WebkitBackdropFilter: "blur(14px) saturate(150%)",
          };

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
            ...surface,
            boxShadow: `0 8px 24px rgba(0,0,0,0.16), 0 0 0 3px ${companionColor}0a`,
            fontSize: compact ? 10 : 12,
            fontWeight: 500,
            color: "rgb(var(--quip-text))",
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
