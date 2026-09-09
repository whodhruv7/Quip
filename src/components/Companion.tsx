// Quip V0.1 — Companion sprites (Pix, Kai, Ren, Bubbles, Capy, Ivy)
//
// Each companion is a CUTE, PIXELATED SVG spirit. Think 32x32 pixel art scaled
// up — blocky but SOFT. Not retro-gaming, not Minecraft. Premium pixel: crisp
// edges, rounded shapes, pastel colors, glowing aura.
//
//   Pix     — aqua/pink, playful spark, round body
//   Kai     — indigo/violet, wise star, angular body
//   Ren     — purple/gold, bold explorer, dark body
//   Bubbles — teal/sky, joyful blob, wobbly round body
//   Capy    — warm tan, calm capybara, cozy body with little ears
//   Skales  — lime gecko, the original Skales buddy, body with tail curl
//
// Each has: idle, hover, thinking, responding, sleeping states — plus the
// agent lifecycle states: planning, working, observing, verifying, waiting,
// success, error, cancelled.

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CompanionId, PixState } from "@/types";
import type { CompanionTheme } from "@/lib/companion-config";
import { COMPANIONS } from "@/lib/companion-config";

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
  // Engaged + determined — a focused little bounce while a task runs.
  working: {
    y: [0, -4.5, 0],
    scale: [1.02, 1.05, 1.02],
    rotate: [0, -1.5, 0, 1.5, 0],
    transition: { duration: 0.9, repeat: Infinity, ease: "easeInOut" },
  },
  // Gentle patient sway while waiting for approval.
  waiting: {
    y: [0, -1.5, 0],
    rotate: [-2.5, 2.5, -2.5],
    transition: { duration: 2.6, repeat: Infinity, ease: "easeInOut" },
  },
  // Happy jump — plays twice, then the caller returns to idle.
  success: {
    y: [0, -9, 0, -5, 0],
    scale: [1, 1.08, 1, 1.05, 1],
    transition: { duration: 0.7, repeat: 1, ease: "easeOut" },
  },
  // Concerned little shake — short, never dramatic.
  error: {
    x: [0, -1.8, 1.8, -1.2, 0],
    y: [0, -1, 0],
    transition: { duration: 0.5, repeat: 1, ease: "easeInOut" },
  },
  // Resolving the task into steps — a quick, smart pulse before acting.
  planning: {
    y: [0, -2.5, 0],
    scale: [1, 1.03, 1],
    transition: { duration: 1.3, repeat: Infinity, ease: "easeInOut" },
  },
  // Reading the screen/page/results — attentive little look-around lean.
  observing: {
    y: [0, -1.5, 0],
    rotate: [0, 2, 0, -2, 0],
    scale: 1.02,
    transition: { duration: 2.2, repeat: Infinity, ease: "easeInOut" },
  },
  // Double-checking a result before reporting success — a small sure nod.
  verifying: {
    y: [0, -1, 0, -1, 0],
    scale: [1, 1.015, 1],
    transition: { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
  },
  // Cancelled — a gentle droop, then calm again. Never dramatic.
  cancelled: {
    y: [0, 2.5, 0.5],
    scale: [1, 0.96, 0.99],
    transition: { duration: 0.7, repeat: 1, ease: "easeInOut" },
  },
};

const blinkVar = {
  open: { scaleY: 1, transition: { duration: 0.07 } },
  blink: { scaleY: 0.08, transition: { duration: 0.07 } },
};

// ---------------------------------------------------------------------------
// Companion SVG body shapes (each unique)
// ---------------------------------------------------------------------------
function PixBody({ t, asleep, blinking, eyeOffset = { x: 0, y: 0 } }: { t: CompanionTheme; asleep: boolean; blinking: boolean; eyeOffset?: { x: number; y: number } }) {
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
      {/* Eyes — pixel squares with cursor tracking offset */}
      <motion.g variants={blinkVar} initial="open"
        animate={asleep ? "blink" : blinking ? "blink" : "open"}
        style={{ originY: "15px", x: eyeOffset.x, y: eyeOffset.y }}>
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

function KaiBody({ t, asleep, blinking, eyeOffset = { x: 0, y: 0 } }: { t: CompanionTheme; asleep: boolean; blinking: boolean; eyeOffset?: { x: number; y: number } }) {
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
        style={{ originY: "14.25px" }}>
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

function RenBody({ t, asleep, blinking, eyeOffset = { x: 0, y: 0 } }: { t: CompanionTheme; asleep: boolean; blinking: boolean; eyeOffset?: { x: number; y: number } }) {
  return (
    <>
      {/* Bold angular antenna */}
      <motion.g animate={{ y: [-0.6, -1.8, -0.6], rotate: [0, 6, -6, 0] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}>
        <line x1="16" y1="3" x2="16" y2="0" stroke={t.secondary} strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
        <polygon points="16,-1 17.5,1.5 19.5,1.5 18,3.5 18.5,5.5 16,4 13.5,5.5 14,3.5 12.5,1.5 14.5,1.5"
          fill={t.secondary} transform="translate(0,1) scale(0.4)" />
      </motion.g>
      {/* Strong angular body - black with gold accents */}
      <rect x="4" y="6" width="24" height="22" rx="6" fill="#1a1a1a" stroke="rgba(255,215,0,0.15)" strokeWidth="0.8" />
      {/* Gold accent lines on body */}
      <rect x="5" y="7" width="22" height="20" rx="5" fill="none" stroke="rgba(255,215,0,0.20)" strokeWidth="0.6" />
      {/* Face panel - darker */}
      <rect x="7" y="10" width="18" height="12" rx="4" fill={t.dark} />
      {/* Eyes — bold, determined look */}
      <motion.g variants={blinkVar} initial="open"
        animate={asleep ? "blink" : blinking ? "blink" : "open"}
        style={{ originY: "14.75px" }}>
        <rect x="10" y="13" width="4" height="3.5" rx="0.6" fill={t.eyeColor} />
        <rect x="18" y="13" width="4" height="3.5" rx="0.6" fill={t.eyeColor} />
      </motion.g>
      {/* Eye highlights */}
      {!asleep && (
        <>
          <rect x="10.5" y="13.5" width="1.2" height="1.2" rx="0.3" fill="white" opacity="0.8" />
          <rect x="18.5" y="13.5" width="1.2" height="1.2" rx="0.3" fill="white" opacity="0.8" />
        </>
      )}
      {/* Cheeks - subtle gold */}
      {!asleep && <><rect x="7" y="17" width="2.5" height="1.8" rx="0.9" fill={t.cheekColor} />
      <rect x="22.5" y="17" width="2.5" height="1.8" rx="0.9" fill={t.cheekColor} /></>}
      {/* Mouth — confident smile */}
      {asleep ? (
        <motion.rect x="14" y="19" width="4" height="1" rx="0.5" fill="#3A4658"
          animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 3, repeat: Infinity }} />
      ) : (
        <rect x="14" y="19" width="4" height="1.6" rx="0.8" fill="#2a2a2a" />
      )}
      {/* Feet - bold with gold accents */}
      <rect x="9" y="27" width="5" height="3" rx="1.2" fill="#1a1a1a" stroke="rgba(255,215,0,0.25)" strokeWidth="0.6" />
      <rect x="18" y="27" width="5" height="3" rx="1.2" fill="#1a1a1a" stroke="rgba(255,215,0,0.25)" strokeWidth="0.6" />
    </>
  );
}

function BubblesBody({ t, asleep, blinking, eyeOffset = { x: 0, y: 0 } }: { t: CompanionTheme; asleep: boolean; blinking: boolean; eyeOffset?: { x: number; y: number } }) {
  return (
    <>
      {/* Bubble antenna — a tiny floating bubble */}
      <motion.g animate={{ y: [-1, -2.6, -1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
        <line x1="16" y1="4" x2="16" y2="2" stroke={t.primary} strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <circle cx="16" cy="1.2" r="1.4" fill="none" stroke={t.primary} strokeWidth="0.8" />
      </motion.g>
      {/* Wobbly round blob body — extra round, extra soft */}
      <motion.rect
        x="4" y="6" width="24" height="22"
        rx="12"
        fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.8"
        animate={{ scale: [1, 1.02, 0.99, 1] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "16px 17px" }}
      />
      {/* Water highlight — a little shine on the top-left */}
      <rect x="7" y="8" width="3" height="2" rx="1" fill={t.secondary} opacity="0.35" />
      {/* Face panel */}
      <rect x="7" y="10" width="18" height="12" rx="6" fill={t.dark} />
      {/* Eyes — big, joyful round pixels */}
      <motion.g variants={blinkVar} initial="open"
        animate={asleep ? "blink" : blinking ? "blink" : "open"}
        style={{ originY: "15px", x: eyeOffset.x, y: eyeOffset.y }}>
        <rect x="10" y="13" width="4.2" height="4.2" rx="1.4" fill={t.eyeColor} />
        <rect x="17.8" y="13" width="4.2" height="4.2" rx="1.4" fill={t.eyeColor} />
      </motion.g>
      {/* Eye highlights */}
      {!asleep && (
        <>
          <rect x="10.4" y="13.4" width="1.4" height="1.4" rx="0.5" fill="white" opacity="0.75" />
          <rect x="18.2" y="13.4" width="1.4" height="1.4" rx="0.5" fill="white" opacity="0.75" />
        </>
      )}
      {/* Cheeks */}
      {!asleep && <><rect x="7" y="17" width="2.5" height="2" rx="1" fill={t.cheekColor} />
      <rect x="22.5" y="17" width="2.5" height="2" rx="1" fill={t.cheekColor} /></>}
      {/* Mouth — happy open smile */}
      {asleep ? (
        <motion.rect x="14" y="19" width="4" height="1.2" rx="0.6" fill="#3A4658"
          animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 3, repeat: Infinity }} />
      ) : (
        <path d="M 13.6 19 Q 16 21.4 18.4 19" fill="none" stroke="#3A4658" strokeWidth="1.1" strokeLinecap="round" />
      )}
      {/* No feet — blobs don't have feet. A soft puddle base instead */}
      <ellipse cx="16" cy="29" rx="7" ry="1.6" fill={t.secondary} opacity="0.25" />
    </>
  );
}

function CapyBody({ t, asleep, blinking, eyeOffset = { x: 0, y: 0 } }: { t: CompanionTheme; asleep: boolean; blinking: boolean; eyeOffset?: { x: number; y: number } }) {
  return (
    <>
      {/* Little rounded ears on top */}
      <motion.g animate={{ y: [-0.4, -1.2, -0.4] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}>
        <rect x="7" y="4" width="4" height="4" rx="1.6" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.6" />
        <rect x="21" y="4" width="4" height="4" rx="1.6" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.6" />
      </motion.g>
      {/* Cozy barrel body — wide and calm */}
      <rect x="3.5" y="7" width="25" height="21" rx="9" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.8" />
      {/* Muzzle panel — slightly warmer face bg */}
      <rect x="7" y="11" width="18" height="11.5" rx="5" fill={t.dark} />
      {/* Eyes — relaxed, half-lidded calm look */}
      <motion.g variants={blinkVar} initial="open"
        animate={asleep ? "blink" : blinking ? "blink" : "open"}
        style={{ originY: "14.5px", x: eyeOffset.x, y: eyeOffset.y }}>
        <rect x="10" y="13" width="3.8" height="3.2" rx="1.2" fill={t.eyeColor} />
        <rect x="18.2" y="13" width="3.8" height="3.2" rx="1.2" fill={t.eyeColor} />
      </motion.g>
      {!asleep && (
        <>
          <rect x="10.4" y="13.3" width="1.2" height="1.2" rx="0.4" fill="white" opacity="0.6" />
          <rect x="18.6" y="13.3" width="1.2" height="1.2" rx="0.4" fill="white" opacity="0.6" />
        </>
      )}
      {/* Cheeks */}
      {!asleep && <><rect x="7" y="16.5" width="2.5" height="2" rx="1" fill={t.cheekColor} />
      <rect x="22.5" y="16.5" width="2.5" height="2" rx="1" fill={t.cheekColor} /></>}
      {/* Mouth — tiny, unbothered */}
      {asleep ? (
        <motion.rect x="14.4" y="19" width="3.2" height="1" rx="0.5" fill="#3A4658"
          animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 3, repeat: Infinity }} />
      ) : (
        <rect x="14.4" y="19" width="3.2" height="1.3" rx="0.65" fill="#3A4658" />
      )}
      {/* Sturdy little feet */}
      <rect x="8" y="27" width="5.5" height="3" rx="1.5" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
      <rect x="18.5" y="27" width="5.5" height="3" rx="1.5" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
    </>
  );
}

function SkalesBody({ t, asleep, blinking, eyeOffset = { x: 0, y: 0 } }: { t: CompanionTheme; asleep: boolean; blinking: boolean; eyeOffset?: { x: number; y: number } }) {
  return (
    <>
      {/* Sprout antenna — a tiny leaf */}
      <motion.g animate={{ rotate: [0, 5, -5, 0], y: [-0.6, -1.8, -0.6] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "16px 4px" }}>
        <line x1="16" y1="4" x2="16" y2="1.5" stroke={t.primary} strokeWidth="1.1" strokeLinecap="round" opacity="0.8" />
        <path d="M 16 1.5 Q 18.6 0.4 18.8 3 Q 17 4.4 16 3 Z" fill={t.secondary} />
      </motion.g>
      {/* Gecko body — slightly longer, with a tail curl on the right */}
      <rect x="4" y="6" width="23" height="22" rx="9" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.8" />
      <motion.path
        d="M 27 22 Q 30.5 23 30 26.5 Q 29.6 29 27 28.5"
        fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round"
        animate={{ d: ["M 27 22 Q 30.5 23 30 26.5 Q 29.6 29 27 28.5", "M 27 22 Q 31 22.5 30.4 26 Q 29.6 28.6 27 28.5", "M 27 22 Q 30.5 23 30 26.5 Q 29.6 29 27 28.5"] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* Face panel */}
      <rect x="7" y="10" width="18" height="12" rx="5" fill={t.dark} />
      {/* Eyes — alert, friendly */}
      <motion.g variants={blinkVar} initial="open"
        animate={asleep ? "blink" : blinking ? "blink" : "open"}
        style={{ originY: "15px", x: eyeOffset.x, y: eyeOffset.y }}>
        <rect x="10" y="13" width="3.8" height="3.8" rx="1" fill={t.eyeColor} />
        <rect x="18.2" y="13" width="3.8" height="3.8" rx="1" fill={t.eyeColor} />
      </motion.g>
      {!asleep && (
        <>
          <rect x="10.4" y="13.3" width="1.3" height="1.3" rx="0.4" fill="white" opacity="0.7" />
          <rect x="18.6" y="13.3" width="1.3" height="1.3" rx="0.4" fill="white" opacity="0.7" />
        </>
      )}
      {/* Cheeks */}
      {!asleep && <><rect x="7" y="17" width="2.5" height="2" rx="1" fill={t.cheekColor} />
      <rect x="22.5" y="17" width="2.5" height="2" rx="1" fill={t.cheekColor} /></>}
      {/* Mouth — ready to help */}
      {asleep ? (
        <motion.rect x="14" y="19" width="4" height="1.2" rx="0.6" fill="#3A4658"
          animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 3, repeat: Infinity }} />
      ) : (
        <rect x="14" y="19" width="4" height="1.6" rx="0.8" fill="#3A4658" />
      )}
      {/* Quick gecko feet */}
      <rect x="9" y="27" width="4.5" height="3" rx="1.4" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
      <rect x="18.5" y="27" width="4.5" height="3" rx="1.4" fill="white" stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
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
  /** Unlocked cosmetic IDs — renders visual upgrades on the companion */
  unlockedCosmetics?: string[];
  /** Animation speed multiplier from Companion Mood (0.5 = slow, 1.5 = fast) */
  moodSpeed?: number;
}

export function Companion({ id, state, size = 80, unlockedCosmetics = [], moodSpeed = 1 }: CompanionProps) {
  const [blink, setBlink] = useState(false);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [wakingUp, setWakingUp] = useState(false);
  const [gesture, setGesture] = useState<"none" | "lookAround" | "doubleBlink" | "wiggle">("none");
  const [showSparkle, setShowSparkle] = useState(false);
  const [showConcern, setShowConcern] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = COMPANIONS.find((c) => c.id === id) ?? COMPANIONS[0];
  const asleep = state === "sleeping";
  const prevState = useRef(state);

  // Success/error accent overlays fire when those states begin.
  useEffect(() => {
    if (state === "success") {
      setShowSparkle(true);
      const t = setTimeout(() => setShowSparkle(false), 1400);
      return () => clearTimeout(t);
    }
    if (state === "error") {
      setShowConcern(true);
      const t = setTimeout(() => setShowConcern(false), 1000);
      return () => clearTimeout(t);
    }
  }, [state]);

  // Idle micro-gestures — a tiny shuffle bag (no repeats until exhausted),
  // played every 30–60s ONLY while idle. Skales-style lifelikeness, zero spam:
  // a quick look around, a double blink, or a small wiggle.
  const gestureBag = useRef<string[]>([]);
  useEffect(() => {
    if (state !== "idle") return;
    let timer: ReturnType<typeof setTimeout>;
    const GESTURES = ["lookAround", "doubleBlink", "wiggle"] as const;
    const play = (g: (typeof GESTURES)[number]) => {
      setGesture(g);
      const dur = g === "lookAround" ? 1600 : g === "wiggle" ? 900 : 500;
      setTimeout(() => setGesture("none"), dur);
    };
    const schedule = () => {
      timer = setTimeout(() => {
        if (gestureBag.current.length === 0) {
          gestureBag.current = [...GESTURES].sort(() => Math.random() - 0.5);
        }
        play(gestureBag.current.pop() as (typeof GESTURES)[number]);
        schedule();
      }, (30_000 + Math.random() * 30_000) / moodSpeed);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [state, moodSpeed]);

  // lookAround: eyes drift side to side once.
  useEffect(() => {
    if (gesture !== "lookAround") return;
    setEyeOffset({ x: 1.6, y: 0 });
    const t1 = setTimeout(() => setEyeOffset({ x: -1.6, y: 0 }), 500);
    const t2 = setTimeout(() => setEyeOffset({ x: 0, y: 0 }), 1100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [gesture]);

  // doubleBlink: two quick blinks.
  useEffect(() => {
    if (gesture !== "doubleBlink") return;
    setBlink(true);
    const t1 = setTimeout(() => setBlink(false), 120);
    const t2 = setTimeout(() => setBlink(true), 300);
    const t3 = setTimeout(() => setBlink(false), 420);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [gesture]);

  // Eye tracking: eyes follow cursor when nearby
  useEffect(() => {
    if (asleep) return;
    const handleMove = (e: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Only track when cursor is within 300px
      if (dist > 300) {
        setEyeOffset({ x: 0, y: 0 });
        return;
      }
      // Max eye offset: 0.8px
      const maxOffset = 0.8;
      const angle = Math.atan2(dy, dx);
      const magnitude = Math.min(maxOffset, maxOffset * (1 - dist / 300));
      setEyeOffset({
        x: Math.cos(angle) * magnitude,
        y: Math.sin(angle) * magnitude,
      });
    };
    window.addEventListener("pointermove", handleMove);
    return () => window.removeEventListener("pointermove", handleMove);
  }, [asleep]);

  // Wake-up animation: when transitioning from sleeping → any other state
  useEffect(() => {
    if (prevState.current === "sleeping" && state !== "sleeping") {
      setWakingUp(true);
      const t = setTimeout(() => setWakingUp(false), 600);
      prevState.current = state;
      return () => clearTimeout(t);
    }
    prevState.current = state;
  }, [state]);

  useEffect(() => {
    if (asleep) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Mood affects blink frequency: low energy = slower blinks
      const next = (2400 + Math.random() * 3800) / moodSpeed;
      timer = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        schedule();
      }, next);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [asleep, moodSpeed]);

  const Body =
    id === "kai" ? KaiBody :
    id === "ren" ? RenBody :
    id === "bubbles" ? BubblesBody :
    id === "capy" ? CapyBody :
    id === "skales" ? SkalesBody :
    PixBody;

  // Scale the float animation duration by mood speed
  const floatVariants = pixFloat;
  // Apply mood speed by adjusting transition durations
  const adjustedVariants = Object.fromEntries(
    Object.entries(floatVariants).map(([key, variant]: [string, any]) => [
      key,
      variant.transition
        ? { ...variant, transition: { ...variant.transition, duration: variant.transition.duration / moodSpeed } }
        : variant,
    ])
  ) as Record<PixState, any>;

  return (
    <motion.div
      ref={containerRef}
      variants={adjustedVariants}
      initial="idle"
      animate={state}
      style={{ width: size, height: size + 8, position: "relative" }}
    >
      {/* Wake-up burst — a quick scale + opacity flash when returning from sleep */}
      <AnimatePresence>
        {wakingUp && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0.5 }}
            animate={{ scale: 1.5, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            style={{
              position: "absolute",
              inset: "-20%",
              borderRadius: "50%",
              border: `2px solid ${theme.primary}`,
              pointerEvents: "none",
            }}
          />
        )}
      </AnimatePresence>
      {/* Success sparkles — tiny twinkles around the sprite */}
      <AnimatePresence>
        {showSparkle && (
          <>
            {[
              { top: "-12%", left: "-8%", delay: 0 },
              { top: "-18%", left: "62%", delay: 0.18 },
              { top: "38%", left: "-20%", delay: 0.32 },
            ].map((pos, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, scale: 0.4, rotate: -20 }}
                animate={{ opacity: [0, 1, 0], scale: [0.4, 1.15, 0.6], rotate: 20 }}
                transition={{ duration: 1.1, delay: pos.delay, ease: "easeOut" }}
                style={{
                  position: "absolute",
                  top: pos.top,
                  left: pos.left,
                  fontSize: Math.max(10, size * 0.16),
                  lineHeight: 1,
                  pointerEvents: "none",
                }}
              >
                ✨
              </motion.span>
            ))}
          </>
        )}
      </AnimatePresence>
      {/* Concern accent — one small blue drop when something failed */}
      <AnimatePresence>
        {showConcern && (
          <motion.span
            initial={{ opacity: 0, y: -6, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], y: 10, scale: 1 }}
            transition={{ duration: 1.0, ease: "easeIn" }}
            style={{
              position: "absolute",
              top: "-6%",
              left: "66%",
              fontSize: Math.max(9, size * 0.14),
              lineHeight: 1,
              pointerEvents: "none",
            }}
          >
            💧
          </motion.span>
        )}
      </AnimatePresence>
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

        <Body t={theme} asleep={asleep} blinking={blink} eyeOffset={eyeOffset} />

        {/* ─── Cosmetic upgrades (rendered on top of body) ──────────── */}
        <Cosmetics id={id} unlocked={unlockedCosmetics} theme={theme} />

        {/* Thinking/responding mouth glow */}
        {(state === "thinking" || state === "responding") && !asleep && (
          <motion.rect
            x="14" y="19.5" width="4" height="1.8" rx="0.9"
            fill={theme.mouthThinking}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1 / moodSpeed, repeat: Infinity }}
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

// ---------------------------------------------------------------------------
// Cosmetics — small visual upgrades unlocked through companion evolution
// ---------------------------------------------------------------------------
function Cosmetics({ id, unlocked, theme }: { id: CompanionId; unlocked: string[]; theme: CompanionTheme }) {
  // Each cosmetic is a small SVG element drawn on top of the companion body.
  // Tier 1 = small accent, Tier 2 = badge, Tier 3 = aura/glow change.

  return (
    <>
      {/* Pix: Tiny Scarf (tier 1) */}
      {id === "pix" && unlocked.includes("pix-tier1") && (
        <g>
          <path d="M 9 23 Q 16 25 23 23 L 22 25 Q 16 27 10 25 Z" fill="#6FD6FF" opacity="0.85" />
          <rect x="8" y="24" width="3" height="5" rx="1" fill="#6FD6FF" opacity="0.7" transform="rotate(15 9.5 26.5)" />
        </g>
      )}

      {/* Pix: Star Sparkle (tier 2) */}
      {id === "pix" && unlocked.includes("pix-tier2") && (
        <motion.g
          animate={{ opacity: [0.4, 1, 0.4], scale: [0.8, 1.1, 0.8] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "28px 6px" }}
        >
          <path d="M 28 4 L 28.8 6 L 30.8 6.8 L 28.8 7.6 L 28 9.6 L 27.2 7.6 L 25.2 6.8 L 27.2 6 Z" fill="#FFD700" />
        </motion.g>
      )}

      {/* Kai: Leaf Accent (tier 1) */}
      {id === "kai" && unlocked.includes("kai-tier1") && (
        <g transform="translate(24 4) rotate(20)">
          <path d="M 0 0 Q 2 -3 4 0 Q 2 3 0 0 Z" fill="#4ade80" opacity="0.85" />
          <line x1="0" y1="0" x2="4" y2="0" stroke="#16a34a" strokeWidth="0.3" />
        </g>
      )}

      {/* Kai: Book Badge (tier 2) */}
      {id === "kai" && unlocked.includes("kai-tier2") && (
        <g transform="translate(22 22)">
          <rect x="0" y="0" width="5" height="4" rx="0.5" fill="#A78BFA" />
          <line x1="2.5" y1="0" x2="2.5" y2="4" stroke="#7c3aed" strokeWidth="0.3" />
        </g>
      )}

      {/* Ren: Curiosity Spark (tier 1) */}
      {id === "ren" && unlocked.includes("ren-tier1") && (
        <motion.g
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <text x="25" y="8" fontSize="5" fill="#FFD700" fontWeight="bold" fontFamily="monospace">?</text>
        </motion.g>
      )}

      {/* Ren: Galaxy Trail (tier 2) */}
      {id === "ren" && unlocked.includes("ren-tier2") && (
        <motion.g
          animate={{ opacity: [0.3, 0.8, 0.3] }}
          transition={{ duration: 3, repeat: Infinity }}
        >
          <circle cx="4" cy="28" r="0.8" fill="#FFD700" />
          <circle cx="2" cy="30" r="0.5" fill="#FFD700" opacity="0.6" />
          <circle cx="6" cy="26" r="0.4" fill="#FFD700" opacity="0.5" />
        </motion.g>
      )}

      {/* Bubbles: Foam Friend (tier 1) */}
      {id === "bubbles" && unlocked.includes("bubbles-tier1") && (
        <motion.g
          animate={{ y: [-0.6, -1.6, -0.6], opacity: [0.6, 0.95, 0.6] }}
          transition={{ duration: 2.2, repeat: Infinity }}
        >
          <circle cx="25" cy="7" r="1.6" fill="none" stroke={theme.primary} strokeWidth="0.7" />
          <circle cx="27.6" cy="10" r="0.8" fill="none" stroke={theme.primary} strokeWidth="0.5" opacity="0.7" />
        </motion.g>
      )}

      {/* Bubbles: Raindrop Charm (tier 2) */}
      {id === "bubbles" && unlocked.includes("bubbles-tier2") && (
        <motion.g
          animate={{ opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: 2.6, repeat: Infinity }}
        >
          <path d="M 6 6 Q 7.4 8 6 9.4 Q 4.6 8 6 6 Z" fill={theme.secondary} />
        </motion.g>
      )}

      {/* Capy: Orange Slice (tier 1) — the classic capybara treat */}
      {id === "capy" && unlocked.includes("capy-tier1") && (
        <g transform="translate(13.5 -1)">
          <circle cx="2.5" cy="2.5" r="2.5" fill="#FFB347" />
          <circle cx="2.5" cy="2.5" r="1.6" fill="#FFE0A3" />
          <g stroke="#FFB347" strokeWidth="0.4">
            <line x1="2.5" y1="1" x2="2.5" y2="4" />
            <line x1="1" y1="2.5" x2="4" y2="2.5" />
          </g>
        </g>
      )}

      {/* Capy: Cozy Blanket (tier 2) */}
      {id === "capy" && unlocked.includes("capy-tier2") && (
        <g>
          <path d="M 6 23 Q 16 26 26 23 L 25.4 26 Q 16 28.6 6.6 26 Z" fill={theme.secondary} opacity="0.8" />
          <rect x="12" y="25.5" width="3" height="4" rx="1" fill={theme.secondary} opacity="0.65" transform="rotate(12 13.5 27.5)" />
        </g>
      )}

      {/* Skales: Vine Wrap (tier 1) */}
      {id === "skales" && unlocked.includes("skales-tier1") && (
        <g>
          <path d="M 5 20 Q 3 17 5 14" fill="none" stroke="#4ade80" strokeWidth="0.8" strokeLinecap="round" opacity="0.85" />
          <path d="M 4.2 16.4 Q 2.6 15.6 2.4 14 Q 4 14.2 4.6 15.4 Z" fill="#4ade80" opacity="0.85" />
        </g>
      )}

      {/* Skales: Berry Charm (tier 2) */}
      {id === "skales" && unlocked.includes("skales-tier2") && (
        <motion.g
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity }}
        >
          <circle cx="25.5" cy="8" r="1" fill="#7BE3A6" />
          <circle cx="27.8" cy="10.2" r="0.7" fill="#7BE3A6" opacity="0.8" />
          <line x1="25.5" y1="8" x2="27.8" y2="10.2" stroke="#4ade80" strokeWidth="0.4" />
        </motion.g>
      )}

      {/* Tier 3 — subtle aura boost for all companions */}
      {(unlocked.includes("pix-tier3") || unlocked.includes("kai-tier3") || unlocked.includes("ren-tier3") ||
        unlocked.includes("bubbles-tier3") || unlocked.includes("capy-tier3") || unlocked.includes("skales-tier3")) && (
        <motion.circle
          cx="16"
          cy="16"
          r="14"
          fill="none"
          stroke={theme.secondary}
          strokeWidth="0.4"
          opacity="0.3"
          animate={{ r: [13, 15, 13], opacity: [0.15, 0.35, 0.15] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </>
  );
}
