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

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CompanionId, PixState } from "@/types";
<<<<<<< HEAD
=======
import { Pix3D } from "@/components/Pix3D";
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276

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
    id: "zee",
    name: "Zee",
    subtitle: "The Fearless Explorer",
    primary: "#1a1a1a",
    secondary: "#FFD700",
    dark: "#0a0a0a",
    eyeColor: "#FFD700",
    cheekColor: "rgba(255,215,0,0.35)",
    auraA: "rgba(26,26,26,0.40)",
    auraB: "rgba(255,215,0,0.20)",
    mouthThinking: "#FFD700",
  },
];

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
        style={{ originY: "32px", x: eyeOffset.x, y: eyeOffset.y }}>
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

function ZeeBody({ t, asleep, blinking, eyeOffset = { x: 0, y: 0 } }: { t: CompanionTheme; asleep: boolean; blinking: boolean; eyeOffset?: { x: number; y: number } }) {
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
        style={{ originY: "32px" }}>
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
<<<<<<< HEAD
=======
  const [pix3dFailed, setPix3dFailed] = useState(false);
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = COMPANIONS.find((c) => c.id === id)!;
  const asleep = state === "sleeping";
  const prevState = useRef(state);

<<<<<<< HEAD
=======
  useEffect(() => {
    if (id === "pix") {
      setPix3dFailed(false);
    }
  }, [id]);

>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
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

  const Body = id === "kai" ? KaiBody : id === "zee" ? ZeeBody : PixBody;

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

<<<<<<< HEAD
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
=======
      {id === "pix" && !pix3dFailed ? (
        <Pix3D
          state={state}
          moodSpeed={moodSpeed}
          onLoadError={() => setPix3dFailed(true)}
        />
      ) : (
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
      )}
>>>>>>> 0e1a87d69b30e3c81fc25e2628e0dc69dfe3e276
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

      {/* Zee: Curiosity Spark (tier 1) */}
      {id === "zee" && unlocked.includes("zee-tier1") && (
        <motion.g
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <text x="25" y="8" fontSize="5" fill="#FFD700" fontWeight="bold" fontFamily="monospace">?</text>
        </motion.g>
      )}

      {/* Zee: Galaxy Trail (tier 2) */}
      {id === "zee" && unlocked.includes("zee-tier2") && (
        <motion.g
          animate={{ opacity: [0.3, 0.8, 0.3] }}
          transition={{ duration: 3, repeat: Infinity }}
        >
          <circle cx="4" cy="28" r="0.8" fill="#FFD700" />
          <circle cx="2" cy="30" r="0.5" fill="#FFD700" opacity="0.6" />
          <circle cx="6" cy="26" r="0.4" fill="#FFD700" opacity="0.5" />
        </motion.g>
      )}

      {/* Tier 3 — subtle aura boost for all companions */}
      {(unlocked.includes("pix-tier3") || unlocked.includes("kai-tier3") || unlocked.includes("zee-tier3")) && (
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
