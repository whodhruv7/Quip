// Quip V2 — Companion theme definitions.
//
// Extracted from Companion.tsx so the rest of the app can import companion
// colors without pulling in the SVG component. Used by App.tsx, TopBar,
// ChatInput, ChatMessage, etc.

import type { CompanionId } from "@/types";

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

export function getCompanion(id: CompanionId): CompanionTheme {
  return COMPANIONS.find((c) => c.id === id) ?? COMPANIONS[0];
}
