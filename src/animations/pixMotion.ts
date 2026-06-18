// Quip V0.1 — Framer Motion variants for Pix.
//
// All motion is subtle and slow to convey calm. No flashing, no big jumps.
// Target feel: a small spirit that is gently alive.

import type { Variants } from "framer-motion";
import type { PixState } from "@/types";

// The whole Pix sprite floats + breathes depending on its state.
export const pixFloat: Variants = {
  idle: {
    y: [0, -4, 0],
    scale: [1, 1.015, 1],
    filter: "drop-shadow(0 0 14px rgba(111,214,255,0.35))",
    transition: {
      duration: 3.4,
      ease: "easeInOut",
      repeat: Infinity,
      repeatType: "mirror",
    },
  },
  hover: {
    y: [0, -2, 0],
    scale: [1.02, 1.04, 1.02],
    filter: "drop-shadow(0 0 22px rgba(111,214,255,0.55))",
    transition: {
      duration: 1.6,
      ease: "easeInOut",
      repeat: Infinity,
      repeatType: "mirror",
    },
  },
  thinking: {
    y: [0, -3, 0],
    scale: [1, 1.02, 1],
    filter: [
      "drop-shadow(0 0 14px rgba(111,214,255,0.35))",
      "drop-shadow(0 0 26px rgba(255,159,239,0.55))",
      "drop-shadow(0 0 14px rgba(111,214,255,0.35))",
    ],
    transition: {
      duration: 1.2,
      ease: "easeInOut",
      repeat: Infinity,
    },
  },
  responding: {
    y: [0, -2, 0],
    scale: [1, 1.03, 1],
    filter: [
      "drop-shadow(0 0 16px rgba(111,214,255,0.5))",
      "drop-shadow(0 0 28px rgba(255,159,239,0.5))",
      "drop-shadow(0 0 16px rgba(111,214,255,0.5))",
    ],
    transition: {
      duration: 0.9,
      ease: "easeInOut",
      repeat: Infinity,
    },
  },
  sleeping: {
    y: [0, -1, 0],
    scale: 1,
    filter: "drop-shadow(0 0 8px rgba(111,214,255,0.15))",
    opacity: 0.7,
    transition: {
      duration: 5,
      ease: "easeInOut",
      repeat: Infinity,
      repeatType: "mirror",
    },
  },
};

// Eyes blink occasionally (driven by a separate motion element).
export const eyeBlink: Variants = {
  open: { scaleY: 1, transition: { duration: 0.06 } },
  blink: { scaleY: 0.1, transition: { duration: 0.06 } },
};

export const stateLabel: Record<PixState, string> = {
  idle: "",
  hover: "",
  thinking: "Pix is thinking",
  responding: "Pix is replying",
  sleeping: "Pix is dozing",
};
