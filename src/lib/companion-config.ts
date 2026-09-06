// Quip V2 — Companion theme definitions.
//
// All 6 companions live in ONE system. Pix, Kai and Ren are Quip originals;
// Bubbles, Capy and Ivy joined the family from the Skales companion roster,
// redrawn in Quip's own pixel-sprite visual language.
//
// Used by App.tsx, TopBar, ChatInput, ChatMessage, etc.

import type { CompanionId } from "../types";

export interface CompanionTheme {
  id: CompanionId;
  name: string;
  subtitle: string;
  primary: string;    // body glow / main accent
  secondary: string;  // secondary accent
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
    subtitle: "The Fearless Explorer",
    primary: "#B98AFF",
    secondary: "#FFD700",
    dark: "#120D1C",
    eyeColor: "#FFD700",
    cheekColor: "rgba(255,215,0,0.35)",
    auraA: "rgba(185,138,255,0.30)",
    auraB: "rgba(255,215,0,0.18)",
    mouthThinking: "#FFD700",
  },
  {
    id: "bubbles",
    name: "Bubbles",
    subtitle: "The Joyful Friend",
    primary: "#5EEAD4",
    secondary: "#7DD3FC",
    dark: "#0A1416",
    eyeColor: "#5EEAD4",
    cheekColor: "rgba(125,211,252,0.45)",
    auraA: "rgba(94,234,212,0.30)",
    auraB: "rgba(125,211,252,0.18)",
    mouthThinking: "#7DD3FC",
  },
  {
    id: "capy",
    name: "Capy",
    subtitle: "The Calm One",
    primary: "#E8B98A",
    secondary: "#FFD9A8",
    dark: "#1A120B",
    eyeColor: "#E8B98A",
    cheekColor: "rgba(217,160,102,0.45)",
    auraA: "rgba(232,185,138,0.30)",
    auraB: "rgba(255,217,168,0.16)",
    mouthThinking: "#FFD9A8",
  },
  {
    id: "ivy",
    name: "Ivy",
    subtitle: "The Loyal Helper",
    primary: "#86E3A8",
    secondary: "#C8F7D8",
    dark: "#0B1410",
    eyeColor: "#86E3A8",
    cheekColor: "rgba(134,227,168,0.40)",
    auraA: "rgba(134,227,168,0.30)",
    auraB: "rgba(200,247,216,0.16)",
    mouthThinking: "#C8F7D8",
  },
];

export function getCompanion(id: CompanionId): CompanionTheme {
  return COMPANIONS.find((c) => c.id === id) ?? COMPANIONS[0];
}
