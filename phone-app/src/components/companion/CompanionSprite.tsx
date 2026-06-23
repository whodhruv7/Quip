'use client'

// Quip Phone App — Companion Sprites
// Calm digital presences. Not mascots. Not toys.
// Idle: 8s subtle float. Thinking: soft pulse. Speaking: tiny movement.
// Animations must not distract.

import { motion } from "framer-motion";
import type { Companion } from "@/lib/quip-design";

interface CompanionSpriteProps {
  companion: Companion;
  size?: number;
  animated?: boolean;
  state?: "idle" | "thinking" | "responding" | "sleeping";
}

export function CompanionSprite({
  companion,
  size = 80,
  animated = true,
  state = "idle",
}: CompanionSpriteProps) {
  const asleep = state === "sleeping";

  // Per directive: idle movement duration 8 seconds, almost invisible
  const floatAnim = animated
    ? {
        animate: asleep
          ? { y: [0, -1, 0], opacity: 0.5 }
          : state === "thinking"
            ? { y: [0, -1.5, 0], scale: [1, 1.01, 1] }
            : state === "responding"
              ? { y: [0, -1, 0] }
              : { y: [0, -2, 0] },  // idle — very subtle
        transition: {
          duration: asleep ? 8 : state === "responding" ? 2 : 8,  // 8s for idle per directive
          repeat: Infinity,
          ease: "easeInOut" as const,
        },
      }
    : {};

  return (
    <motion.div
      animate={floatAnim.animate}
      transition={floatAnim.transition}
      style={{
        width: size,
        height: size,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Subtle aura — barely visible */}
      <div
        style={{
          position: "absolute",
          inset: "-10%",
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 45%, ${companion.primary}15 0%, transparent 70%)`,
          filter: "blur(6px)",
          opacity: asleep ? 0.3 : 0.6,
        }}
      />

      {/* SVG body */}
      <svg
        viewBox="0 0 40 40"
        width={size}
        height={size}
        style={{ position: "relative", overflow: "visible" }}
      >
        {companion.id === "pix" && <PixBody c={companion} asleep={asleep} />}
        {companion.id === "kai" && <KaiBody c={companion} asleep={asleep} />}
        {companion.id === "ren" && <RenBody c={companion} asleep={asleep} />}
      </svg>
    </motion.div>
  );
}

// ─── Pix — The Creative Spark ────────────────────────────────────────────────
// Rounded body, small antenna, calm presence.
function PixBody({ c, asleep }: { c: Companion; asleep: boolean }) {
  return (
    <>
      <ellipse cx="20" cy="36" rx="8" ry="1.5" fill="rgba(0,0,0,0.12)" />

      {/* Antenna — minimal */}
      <line x1="20" y1="5" x2="20" y2="2.5" stroke={c.primary} strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      <circle cx="20" cy="2" r="1.2" fill={c.primary} opacity="0.8" />

      {/* Body — rounded */}
      <rect x="7" y="7" width="26" height="25" rx="12" fill={c.dark} />

      {/* Face panel */}
      <rect x="10" y="11" width="20" height="13" rx="5.5" fill="#000" opacity="0.4" />

      {/* Eyes — calm */}
      <motion.g
        animate={asleep ? { scaleY: 0.08 } : { scaleY: [1, 1, 0.08, 1] }}
        transition={{ duration: 0.12, repeat: asleep ? 0 : Infinity, repeatDelay: 4, times: [0, 0.9, 0.93, 1] }}
        style={{ originY: "15px" }}
      >
        <rect x="13.5" y="14" width="3.5" height="3.5" rx="1" fill={c.primary} />
        <rect x="22.5" y="14" width="3.5" height="3.5" rx="1" fill={c.primary} />
      </motion.g>

      {/* Eye highlights — subtle */}
      {!asleep && (
        <>
          <rect x="14" y="14.5" width="1" height="1" rx="0.3" fill="white" opacity="0.6" />
          <rect x="23" y="14.5" width="1" height="1" rx="0.3" fill="white" opacity="0.6" />
        </>
      )}

      {/* Mouth — soft smile */}
      {asleep ? (
        <line x1="18.5" y1="21" x2="21.5" y2="21" stroke={c.secondary} strokeWidth="0.8" strokeLinecap="round" opacity="0.4" />
      ) : (
        <path d="M 18 21 Q 20 22.5 22 21" stroke={c.secondary} strokeWidth="0.8" strokeLinecap="round" fill="none" opacity="0.7" />
      )}

      {/* Feet */}
      <rect x="11" y="31" width="5.5" height="2.5" rx="1.25" fill={c.dark} />
      <rect x="23.5" y="31" width="5.5" height="2.5" rx="1.25" fill={c.dark} />
    </>
  );
}

// ─── Kai — The Wise Guide ────────────────────────────────────────────────────
// Angular body, minimal movement, deep presence.
function KaiBody({ c, asleep }: { c: Companion; asleep: boolean }) {
  return (
    <>
      <ellipse cx="20" cy="36" rx="8" ry="1.5" fill="rgba(0,0,0,0.12)" />

      {/* Minimal antenna */}
      <line x1="20" y1="5" x2="20" y2="3" stroke={c.primary} strokeWidth="1" strokeLinecap="round" opacity="0.5" />
      <circle cx="20" cy="2.5" r="1" fill={c.primary} opacity="0.7" />

      {/* Body — slightly taller, angular */}
      <rect x="7" y="6" width="26" height="27" rx="10" fill={c.dark} />

      {/* Face panel */}
      <rect x="10" y="10" width="20" height="14" rx="5.5" fill="#000" opacity="0.4" />

      {/* Eyes — analytical, narrower */}
      <motion.g
        animate={asleep ? { scaleY: 0.08 } : { scaleY: [1, 1, 0.08, 1] }}
        transition={{ duration: 0.12, repeat: asleep ? 0 : Infinity, repeatDelay: 5, times: [0, 0.9, 0.93, 1] }}
        style={{ originY: "14px" }}
      >
        <rect x="13.5" y="13" width="3.5" height="3" rx="1" fill={c.primary} />
        <rect x="22.5" y="13" width="3.5" height="3" rx="1" fill={c.primary} />
      </motion.g>

      {!asleep && (
        <>
          <rect x="14" y="13.5" width="0.8" height="0.8" rx="0.2" fill="white" opacity="0.5" />
          <rect x="23" y="13.5" width="0.8" height="0.8" rx="0.2" fill="white" opacity="0.5" />
        </>
      )}

      {/* Mouth — calm line */}
      {asleep ? (
        <line x1="18.5" y1="20" x2="21.5" y2="20" stroke={c.secondary} strokeWidth="0.8" strokeLinecap="round" opacity="0.3" />
      ) : (
        <line x1="18.5" y1="20" x2="21.5" y2="20" stroke={c.secondary} strokeWidth="0.8" strokeLinecap="round" opacity="0.6" />
      )}

      <rect x="11" y="32" width="5.5" height="2.5" rx="1.25" fill={c.dark} />
      <rect x="23.5" y="32" width="5.5" height="2.5" rx="1.25" fill={c.dark} />
    </>
  );
}

// ─── Ren — The Memory Keeper ─────────────────────────────────────────────────
// Oval body, soft ring, warm presence.
function RenBody({ c, asleep }: { c: Companion; asleep: boolean }) {
  return (
    <>
      <ellipse cx="20" cy="36" rx="8" ry="1.5" fill="rgba(0,0,0,0.12)" />

      {/* Soft orbiting ring — very slow */}
      <motion.g
        animate={{ rotate: asleep ? 0 : 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        style={{ transformOrigin: "20px 20px" }}
      >
        <ellipse cx="20" cy="20" rx="15" ry="5" fill="none" stroke={c.secondary} strokeWidth="0.4" opacity="0.25" />
        <circle cx="35" cy="20" r="1" fill={c.secondary} opacity="0.5" />
      </motion.g>

      {/* Body — oval */}
      <ellipse cx="20" cy="20" rx="12" ry="13" fill={c.dark} />

      {/* Face panel */}
      <ellipse cx="20" cy="18" rx="9.5" ry="6.5" fill="#000" opacity="0.4" />

      {/* Eyes — gentle */}
      <motion.g
        animate={asleep ? { scaleY: 0.08 } : { scaleY: [1, 1, 0.08, 1] }}
        transition={{ duration: 0.12, repeat: asleep ? 0 : Infinity, repeatDelay: 3.5, times: [0, 0.9, 0.93, 1] }}
        style={{ originY: "15px" }}
      >
        <circle cx="15.5" cy="15" r="1.8" fill={c.primary} />
        <circle cx="24.5" cy="15" r="1.8" fill={c.primary} />
      </motion.g>

      {!asleep && (
        <>
          <circle cx="16" cy="14.5" r="0.5" fill="white" opacity="0.6" />
          <circle cx="25" cy="14.5" r="0.5" fill="white" opacity="0.6" />
        </>
      )}

      {/* Cheeks — subtle */}
      {!asleep && (
        <>
          <circle cx="11.5" cy="19" r="1.2" fill={c.secondary} opacity="0.2" />
          <circle cx="28.5" cy="19" r="1.2" fill={c.secondary} opacity="0.2" />
        </>
      )}

      {/* Mouth — soft smile */}
      {asleep ? (
        <line x1="18.5" y1="21" x2="21.5" y2="21" stroke={c.secondary} strokeWidth="0.8" strokeLinecap="round" opacity="0.3" />
      ) : (
        <path d="M 17.5 21 Q 20 22.5 22.5 21" stroke={c.secondary} strokeWidth="0.8" strokeLinecap="round" fill="none" opacity="0.6" />
      )}

      <ellipse cx="14" cy="32" rx="2.5" ry="1.8" fill={c.dark} />
      <ellipse cx="26" cy="32" rx="2.5" ry="1.8" fill={c.dark} />
    </>
  );
}
