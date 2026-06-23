'use client'

// Quip Phone App — Quip Keyboard
// Apple-quality keys. Calm. Premium. No gaming colors.
// Key radius: 12dp. Animation: 100ms. Spring physics.

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { tones, type QuipTheme, type QuipStyle, colors, space, radius } from "@/lib/quip-design";

interface QuipKeyboardProps {
  theme: QuipTheme;
  style: QuipStyle;
  activeTone: string | null;
  onKeyPress?: (key: string) => void;
  onToneSelect?: (toneId: string) => void;
  onAIRequest?: () => void;
}

const ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["shift", "z", "x", "c", "v", "b", "n", "m", "delete"],
  ["123", "emoji", "space", "return"],
];

export function QuipKeyboard({
  theme,
  style,
  activeTone,
  onKeyPress,
  onToneSelect,
  onAIRequest,
}: QuipKeyboardProps) {
  const [shiftOn, setShiftOn] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  const handleKey = useCallback(
    (key: string) => {
      setPressedKey(key);
      setTimeout(() => setPressedKey((p) => (p === key ? null : p)), 80);
      if (key === "shift") {
        setShiftOn((s) => !s);
        return;
      }
      const char = shiftOn && key.length === 1 ? key.toUpperCase() : key;
      onKeyPress?.(char);
    },
    [shiftOn, onKeyPress]
  );

  const handleTone = useCallback(
    (toneId: string) => {
      onToneSelect?.(toneId);
    },
    [onToneSelect]
  );

  const renderKey = (key: string, index: number) => {
    const isSpecial = key.length > 1;
    const isSpace = key === "space";
    const isShift = key === "shift";
    const isDelete = key === "delete";
    const isReturn = key === "return";
    const isPressed = pressedKey === key;

    let flex = 1;
    if (isSpace) flex = 5;
    if (isShift || isDelete) flex = 1.8;
    if (key === "123" || key === "emoji") flex = 1.5;
    if (isReturn) flex = 1.5;

    let label: React.ReactNode = key;
    if (isSpace) label = null;
    if (isShift) label = "⇧";
    if (isDelete) label = "⌫";
    if (isReturn) label = "return";
    if (key === "123") label = "123";
    if (key === "emoji") label = "•••";

    const displayChar = shiftOn && key.length === 1 ? key.toUpperCase() : key;

    return (
      <motion.button
        key={`${key}-${index}`}
        onClick={() => handleKey(key)}
        whileTap={{ scale: 0.95 }}
        transition={{ duration: 0.1, ease: [0.16, 1, 0.3, 1] }}
        style={{
          flex,
          height: 40,
          borderRadius: 10,
          border: "none",
          cursor: "pointer",
          fontSize: 16,
          fontWeight: 400,
          color: colors.textPrimary,
          fontFamily: "inherit",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...getKeyStyle(key, style, theme, isPressed, shiftOn && isShift),
        }}
      >
        {isSpace ? (
          <QuipSpaceBar theme={theme} onClick={onAIRequest} />
        ) : isSpecial ? (
          label
        ) : (
          displayChar
        )}
      </motion.button>
    );
  };

  return (
    <div
      style={{
        background: getKeyboardBg(style, theme),
        backdropFilter: style.id === "glass" ? "blur(30px)" : "none",
        WebkitBackdropFilter: style.id === "glass" ? "blur(30px)" : "none",
        borderTop: `0.5px solid ${colors.border}`,
        paddingBottom: 36,
        paddingTop: 6,
        paddingLeft: 3,
        paddingRight: 3,
      }}
    >
      {/* Tone Selector — no emojis, clean pills */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "6px 6px 8px",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {tones.slice(0, 5).map((tone) => {
          const isActive = activeTone === tone.id;
          return (
            <motion.button
              key={tone.id}
              onClick={() => handleTone(tone.id)}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.12 }}
              style={{
                flexShrink: 0,
                padding: "6px 14px",
                borderRadius: radius.full,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "inherit",
                transition: "all 0.18s ease",
                ...getToneStyle(isActive, theme),
              }}
            >
              {tone.name}
            </motion.button>
          );
        })}
        <motion.button
          whileTap={{ scale: 0.95 }}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: radius.full,
            border: "none",
            cursor: "pointer",
            background: colors.glassLight,
            color: colors.textTertiary,
            fontSize: 16,
            fontFamily: "inherit",
          }}
        >
          +
        </motion.button>
      </div>

      {/* QWERTY Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 2px" }}>
        {ROWS.map((row, rowIdx) => (
          <div
            key={rowIdx}
            style={{
              display: "flex",
              gap: 5,
              justifyContent: row.length < 10 ? "center" : "flex-start",
            }}
          >
            {row.map((key, keyIdx) => renderKey(key, keyIdx))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Quip Space Bar ──────────────────────────────────────────────────────────
// Subtle. Not flashy. "Quip" text only.
function QuipSpaceBar({ theme, onClick }: { theme: QuipTheme; onClick?: () => void }) {
  return (
    <motion.div
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.1 }}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        background: `${theme.primary}10`,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: colors.textTertiary,
          letterSpacing: 0.02,
        }}
      >
        Quip
      </span>
    </motion.div>
  );
}

// ─── Style Helpers ───────────────────────────────────────────────────────────

function getKeyboardBg(style: QuipStyle, theme: QuipTheme): string {
  switch (style.id) {
    case "glass":
      return "rgba(17, 17, 19, 0.72)";
    case "glow":
      return "#111113";
    case "gradient":
      return `linear-gradient(180deg, #111113 0%, ${theme.primary}06 100%)`;
    case "minimal":
      return "#0B0B0C";
    default:
      return "#111113";
  }
}

function getKeyStyle(
  key: string,
  style: QuipStyle,
  theme: QuipTheme,
  isPressed: boolean,
  isActive: boolean
): React.CSSProperties {
  const isSpecial = key.length > 1;
  const isSpace = key === "space";
  const isReturn = key === "return";

  if (isSpace) {
    return { background: "transparent", padding: 0 };
  }

  let bg = colors.glassLight;

  switch (style.id) {
    case "glass":
      bg = isSpecial ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)";
      break;
    case "glow":
      bg = isSpecial ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)";
      break;
    case "gradient":
      bg = isSpecial
        ? "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.05))"
        : "linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))";
      break;
    case "minimal":
      bg = isSpecial ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)";
      break;
  }

  if (isActive) bg = theme.primary;
  if (isReturn) bg = theme.primary;

  return {
    background: bg,
    opacity: isPressed ? 0.6 : 1,
  };
}

function getToneStyle(isActive: boolean, theme: QuipTheme): React.CSSProperties {
  if (isActive) {
    return {
      background: theme.primary,
      color: "#FFFFFF",
    };
  }
  return {
    background: colors.glassLight,
    color: colors.textSecondary,
  };
}
