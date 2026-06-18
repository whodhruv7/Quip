// Quip V0.1 — Companion sprites (Pix, Kai, Ren)
//
// Each companion is a CUTE, PIXELATED SVG spirit. Think 32x32 pixel art scaled
// up — blocky but SOFT. Not retro-gaming, not Minecraft. Premium pixel: crisp
// edges, rounded shapes, pastel colors, glowing aura.
//
// Reference: the 3 pixelated companions from the concept art.
//   Pix  — aqua/pink, playful spark, round body
//   Kai  — blue/indigo, wise star, angular body
//   Ren  — green/teal, calm ring, oval body
//
// Each has: idle, hover, thinking, responding, sleeping states.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { CompanionId, PixState } from "@/types";

// ---------------------------------------------------------------------------
// Motion variants — subtle, calm, alive
// ---------------------------------------------------------------------------
const pixFloat: Record<PixState, any> = {
  idle: {
    y: [0, -3, 0],
    scale: [1, 1.012, 1],
    transition: { duration: 3.6, repeat: Infinity, ease: "easeInOut" },
  },
  hover: {
    y: [0, -2, 0],
    scale: [1.03, 1.05, 1.03],
    transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
  },
  thinking: {
    y: [0, -2, 0],
    scale: [1, 1.02, 1],
    transition: { duration: 1.1, repeat: Infinity, ease: "easeInOut" },
  },
  responding: {
    y: [0, -1.5, 0],
    scale: [1.01, 1.035, 1.01],
    transition: { duration: 0.85, repeat: Infinity, ease: "easeInOut" },
  },
  sleeping: {
    y: [0, -1, 0],
    scale: 1,
    opacity: 0.6,
    transition: { duration: 5, repeat: Infinity, ease: "easeInOut" },
  },
};

const blinkVar = {
  open: { scaleY: 1, transition: { duration: 0.07 } },
  blink: { scaleY: 0.08, transition: { duration: 0.07 } },
};

// ---------------------------------------------------------------------------
// Theme per companion
// ---------------------------------------------------------------------------
export interface CompanionTheme {
  id: CompanionId;
  name: string;
  subtitle: string;
  primary: string;    // body glow
  secondary: string;  // accent
  dark: string;       // face bg
  eyeColor: string;
  cheekColor: string;
  auraA: string;
  auraB: string;
  mouthThinking: string;
}

export const COMPANIONS: CompanionTheme[] = [
  {
    id: "pix",
    name: "Pix",
    subtitle: "The Creative Spark",
    primary: "#6FD6FF",
    secondary: "#FF9FEF",
    dark: "#0C1018",
    eyeColor: "#6FD6FF",
    cheekColor: "rgba(255,159,239,0.45)",
    auraA: "rgba(111,214,255,0.30)",
    auraB: "rgba(255,159,239,0.18)",
    mouthThinking: "#FF9FEF",
  },
  {
    id: "kai",
    name: "Kai",
    subtitle: "The Wise Guide",
    primary: "#7B8CFF",
    secondary: "#A78BFA",
    dark: "#0C0E18",
    eyeColor: "#7B8CFF",
    cheekColor: "rgba(167,139,250,0.40)",
    auraA: "rgba(123,140,255,0.28)",
    auraB: "rgba(167,139,250,0.16)",
    mouthThinking: "#A78BFA",
  },
  {
    id: "ren",
    name: "Ren",
    subtitle: "The Memory Keeper",
    primary: "#34D399",
    secondary: "#6EE7B7",
    dark: "#0C1410",
    eyeColor: "#34D399",
    cheekColor: "rgba(110,231,183,0.40)",
    auraA: "rgba(52,211,153,0.28)",
    auraB: "rgba(110,231,183,0.14)",
    mouthThinking: "#34D399",
  },
];

// ---------------------------------------------------------------------------
// Companion SVG body shapes (each unique)
// ---------------------------------------------------------------------------
function PixBody({ t, asleep, blinking }: { t: CompanionTheme; asleep: boolean; blinking: boolean }) {
  return (
    <>
      {/* Antenna spark */}
      <motion.g animate={{ y: [-0.8, -2, -0.8] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}>
        <line x1="16" y1="3" x2="16" y2="1" stroke={t.primary} strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <rect x="14.5" y="0" width="3" height="3" rx="0.5" fill={t.primary} />
      </motion.g>
      {/* Round pixel body */}
      <rect x="4" y="6" width="24" height="22" rx="10" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.8" />
      {/* Face panel */}
      <rect x="7" y="10" width="18" height="12" rx="5" fill={t.dark} />
      {/* Eyes — pixel squares */}
      <motion.g variants={blinkVar} initial="open"
        animate={asleep ? "blink" : blinking ? "blink" : "open"}
        style={{ originY: "32px" }}>
        <rect x="10" y="13" width="4" height="4" rx="0.8" fill={t.eyeColor} />
        <rect x="18" y="13" width="4" height="4" rx="0.8" fill={t.eyeColor} />
      </motion.g>
      {/* Eye highlights */}
      {!asleep && (
        <>
          <rect x="10" y="13" width="1.5" height="1.5" rx="0.4" fill="white" opacity="0.7" />
          <rect x="18" y="13" width="1.5" height="1.5" rx="0.4" fill="white" opacity="0.7" />
        </>
      )}
      {/* Cheeks */}
      {!asleep && <><rect x="7" y="17" width="2.5" height="2" rx="1" fill={t.cheekColor} />
      <rect x="22.5" y="17" width="2.5" height="2" rx="1" fill={t.cheekColor} /></>}
      {/* Mouth */}
      {asleep ? (
        <motion.rect x="14" y="19" width="4" height="1.2" rx="0.6" fill="#3A4658"
          animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 3, repeat: Infinity }} />
      ) : (
        <rect x="14" y="19" width="4" height="1.8" rx="0.9" fill="#3A4658" />
      )}
      {/* Feet */}
      <rect x="9" y="27" width="5" height="3" rx="1.5" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
      <rect x="18" y="27" width="5" height="3" rx="1.5" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
    </>
  );
}

function KaiBody({ t, asleep, blinking }: { t: CompanionTheme; asleep: boolean; blinking: boolean }) {
  return (
    <>
      {/* Star antenna */}
      <motion.g animate={{ y: [-0.8, -2.2, -0.8], rotate: [0, 8, -8, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
        <line x1="16" y1="3" x2="16" y2="1" stroke={t.primary} strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <polygon points="16,0 17.2,1.8 19.2,2 17.6,3.4 18,5.2 16,4.2 14,5.2 14.4,3.4 12.8,2 14.8,1.8"
          fill={t.primary} transform="translate(-16,-4) translate(16,0) scale(0.35)" />
        <rect x="14.5" y="-1" width="3" height="3" rx="0.3" fill={t.primary} />
      </motion.g>
      {/* Angular pixel body (slightly taller) */}
      <rect x="4" y="5" width="24" height="24" rx="8" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.8" />
      {/* Face panel */}
      <rect x="7" y="9" width="18" height="13" rx="5" fill={t.dark} />
      {/* Eyes — slightly narrower, wise look */}
      <motion.g variants={blinkVar} initial="open"
        animate={asleep ? "blink" : blinking ? "blink" : "open"}
        style={{ originY: "34px" }}>
        <rect x="10" y="12" width="3.5" height="4.5" rx="0.8" fill={t.eyeColor} />
        <rect x="18.5" y="12" width="3.5" height="4.5" rx="0.8" fill={t.eyeColor} />
      </motion.g>
      {!asleep && (
        <>
          <rect x="10" y="12" width="1.2" height="1.5" rx="0.3" fill="white" opacity="0.65" />
          <rect x="18.5" y="12" width="1.2" height="1.5" rx="0.3" fill="white" opacity="0.65" />
        </>
      )}
      {/* Cheeks */}
      {!asleep && <><rect x="7" y="18" width="2.5" height="2" rx="1" fill={t.cheekColor} />
      <rect x="22.5" y="18" width="2.5" height="2" rx="1" fill={t.cheekColor} /></>}
      {/* Mouth — slightly neutral, wise */}
      {asleep ? (
        <motion.rect x="14" y="20" width="4" height="1.2" rx="0.6" fill="#3A4658"
          animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 3, repeat: Infinity }} />
      ) : (
        <rect x="14" y="19.5" width="4" height="1.5" rx="0.75" fill="#3A4658" />
      )}
      {/* Feet — slightly wider */}
      <rect x="8" y="28" width="6" height="3" rx="1.5" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
      <rect x="18" y="28" width="6" height="3" rx="1.5" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
    </>
  );
}

function RenBody({ t, asleep, blinking }: { t: CompanionTheme; asleep: boolean; blinking: boolean }) {
  return (
    <>
      {/* Ring/halo antenna — Ren's signature */}
      <motion.g animate={{ y: [-0.5, -1.5, -0.5], rotate: [0, 5, -5, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
        <rect x="14.5" y="-1" width="3" height="3" rx="1.5" fill="none" stroke={t.primary} strokeWidth="1" opacity="0.7" />
        <line x1="16" y1="2" x2="16" y2="4" stroke={t.primary} strokeWidth="1" strokeLinecap="round" opacity="0.5" />
      </motion.g>
      {/* Oval/softer pixel body */}
      <rect x="4" y="7" width="24" height="20" rx="11" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.8" />
      {/* Face panel */}
      <rect x="7" y="11" width="18" height="11" rx="5" fill={t.dark} />
      {/* Eyes — rounder, gentler */}
      <motion.g variants={blinkVar} initial="open"
        animate={asleep ? "blink" : blinking ? "blink" : "open"}
        style={{ originY: "32px" }}>
        <rect x="10" y="14" width="4" height="3.5" rx="1.2" fill={t.eyeColor} />
        <rect x="18" y="14" width="4" height="3.5" rx="1.2" fill={t.eyeColor} />
      </motion.g>
      {!asleep && (
        <>
          <rect x="10" y="14" width="1.3" height="1.3" rx="0.4" fill="white" opacity="0.65" />
          <rect x="18" y="14" width="1.3" height="1.3" rx="0.4" fill="white" opacity="0.65" />
        </>
      )}
      {/* Cheeks */}
      {!asleep && <><rect x="7" y="18" width="2.5" height="1.8" rx="0.9" fill={t.cheekColor} />
      <rect x="22.5" y="18" width="2.5" height="1.8" rx="0.9" fill={t.cheekColor} /></>}
      {/* Mouth — soft, caring */}
      {asleep ? (
        <motion.rect x="14" y="20" width="4" height="1" rx="0.5" fill="#3A4658"
          animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 3, repeat: Infinity }} />
      ) : (
        <rect x="14" y="20" width="4" height="1.4" rx="0.7" fill="#3A4658" />
      )}
      {/* Feet — smaller, gentle */}
      <rect x="10" y="26" width="4" height="2.5" rx="1.2" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
      <rect x="18" y="26" width="4" height="2.5" rx="1.2" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface CompanionProps {
  id: CompanionId;
  state: PixState;
  size?: number;
}

export function Companion({ id, state, size = 80 }: CompanionProps) {
  const [blink, setBlink] = useState(false);
  const theme = COMPANIONS.find((c) => c.id === id)!;
  const asleep = state === "sleeping";

  useEffect(() => {
    if (asleep) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const next = 2400 + Math.random() * 3800;
      timer = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        schedule();
      }, next);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [asleep]);

  const Body = id === "kai" ? KaiBody : id === "ren" ? RenBody : PixBody;

  return (
    <motion.div
      variants={pixFloat}
      initial="idle"
      animate={state}
      style={{ width: size, height: size + 8, position: "relative" }}
    >
      {/* Soft aura */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: "-22%",
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 45%, ${theme.auraA} 0%, ${theme.auraB} 50%, transparent 75%)`,
          filter: "blur(2px)",
        }}
      />

      <svg
        viewBox="-2 -4 36 38"
        width={size}
        height={size + 8}
        style={{ position: "relative", display: "block", overflow: "visible" }}
      >
        <defs>
          <radialGradient id={`face-${id}`} cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor={theme.dark} />
            <stop offset="100%" stopColor="#000" stopOpacity="0.15" />
          </radialGradient>
        </defs>

        {/* Shadow */}
        <ellipse cx="16" cy="32" rx="8" ry="1.8" fill="rgba(0,0,0,0.08)" />

        <Body t={theme} asleep={asleep} blinking={blink} />

        {/* Thinking/responding mouth glow */}
        {(state === "thinking" || state === "responding") && !asleep && (
          <motion.rect
            x="14" y="19.5" width="4" height="1.8" rx="0.9"
            fill={theme.mouthThinking}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        )}

        {/* Sleeping Z's */}
        {asleep && (
          <motion.g
            animate={{ y: -3, opacity: [0, 0.6, 0] }}
            transition={{ duration: 2.5, repeat: Infinity }}
          >
            <text x="26" y="8" fontSize="6" fill={theme.primary} fontWeight="bold" fontFamily="monospace">z</text>
          </motion.g>
        )}
      </svg>
    </motion.div>
  );
}
