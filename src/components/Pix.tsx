// Quip V0.1 — Pix, the companion.
//
// Visual: a premium "pixel spirit" — a rounded white shell, dark face panel,
// two aqua pixel eyes, a tiny pink antenna core, and a soft outer aura.
// Built as layered SVG so every state can animate independently.
//
// This is NOT a robot, pet, or mascot. It's a small digital presence made of
// light. Cute, but premium — Apple/Arc/Linear level, not gaming.
//
// States are driven by Framer Motion (see animations/pixMotion.ts):
//   idle / hover / thinking / responding / sleeping
//
// Future (NOT in V0.1): Kai, Ren, companion evolution, expressions library.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { PixState } from "@/types";
import { pixFloat, eyeBlink } from "@/animations/pixMotion";

interface PixProps {
  state: PixState;
  /** size in px (logical) */
  size?: number;
}

export function Pix({ state, size = 96 }: PixProps) {
  // Random blink — only meaningful when awake and not mid-thought.
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (state === "sleeping") return; // sleeping eyes stay closed
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const next = 2200 + Math.random() * 3600;
      timer = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 130);
        schedule();
      }, next);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [state]);

  const asleep = state === "sleeping";

  return (
    <motion.div
      variants={pixFloat}
      initial="idle"
      animate={state}
      style={{ width: size, height: size, position: "relative" }}
    >
      {/* Soft aura halo behind Pix */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: "-18%",
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 50% 45%, rgba(111,214,255,0.30) 0%, rgba(255,159,239,0.14) 45%, transparent 72%)",
          filter: "blur(2px)",
        }}
      />

      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        style={{ position: "relative", display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id="pixShell" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#EAF7FF" />
          </linearGradient>
          <linearGradient id="pixCore" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6FD6FF" />
            <stop offset="100%" stopColor="#FF9FEF" />
          </linearGradient>
          <radialGradient id="pixFace" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="#1B2330" />
            <stop offset="100%" stopColor="#0C1018" />
          </radialGradient>
        </defs>

        {/* Antenna / core — a tiny floating spark above the head */}
        <motion.g
          animate={{ y: [-1, -2.5, -1] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <line
            x1="32"
            y1="12"
            x2="32"
            y2="7"
            stroke="#6FD6FF"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.7"
          />
          <circle cx="32" cy="6" r="2.4" fill="url(#pixCore)" />
        </motion.g>

        {/* Rounded pixel-spirit shell (squircle) */}
        <path
          d="M32 6
             C46 6 56 16 56 30
             C56 40 50 48 42 52
             C38 54 34 56 32 58
             C30 56 26 54 22 52
             C14 48 8 40 8 30
             C8 16 18 6 32 6 Z"
          fill="url(#pixShell)"
          stroke="rgba(17,17,17,0.06)"
          strokeWidth="1"
        />

        {/* Dark face panel — rounded pixel rectangle */}
        <rect
          x="16"
          y="22"
          width="32"
          height="20"
          rx="8"
          ry="8"
          fill="url(#pixFace)"
        />

        {/* Eyes — aqua pixel squares that blink/sleep */}
        <motion.g
          variants={eyeBlink}
          initial="open"
          animate={asleep ? "blink" : blink ? "blink" : "open"}
          style={{ originY: "30px" }}
        >
          {/* left eye */}
          <rect x="23" y="28" width="5" height="6" rx="1.5" fill="#6FD6FF" />
          {/* right eye */}
          <rect x="36" y="28" width="5" height="6" rx="1.5" fill="#6FD6FF" />
        </motion.g>

        {/* Tiny mouth — changes subtly with state */}
        {asleep ? (
          // soft sleeping line
          <motion.rect
            x="29"
            y="37"
            width="6"
            height="1.6"
            rx="0.8"
            fill="#3A4658"
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
        ) : state === "thinking" || state === "responding" ? (
          <motion.rect
            x="29.5"
            y="37"
            width="5"
            height="2.4"
            rx="1.2"
            fill="#FF9FEF"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        ) : (
          // gentle neutral smile (tiny)
          <rect x="29" y="37" width="6" height="2" rx="1" fill="#3A4658" />
        )}

        {/* Cheek blush — pink, subtle, only when awake */}
        {!asleep && (
          <>
            <circle cx="20" cy="36" r="2" fill="#FF9FEF" opacity="0.45" />
            <circle cx="44" cy="36" r="2" fill="#FF9FEF" opacity="0.45" />
          </>
        )}

        {/* Bottom hover shadow */}
        <ellipse
          cx="32"
          cy="61"
          rx="14"
          ry="2.2"
          fill="rgba(17,17,17,0.10)"
        />
      </svg>
    </motion.div>
  );
}
