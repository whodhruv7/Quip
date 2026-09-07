export interface Companion {
  id: "pix" | "kai" | "ren";
  name: string;
  tagline: string;
  description: string;
  personality: string;
  primary: string;
  secondary: string;
  dark: string;
}

export const companions: Companion[] = [
  {
    id: "pix",
    name: "Pix",
    tagline: "The Creative Spark",
    description: "Playful, curious, optimistic. A smart friend who celebrates progress.",
    personality: "Playful & Creative",
    primary: "#8B7CF6",
    secondary: "#6BA6FF",
    dark: "#0F0F14",
  },
  {
    id: "kai",
    name: "Kai",
    tagline: "The Wise Guide",
    description: "Calm, intelligent, focused. Like having coffee with a mentor.",
    personality: "Wise & Intelligent",
    primary: "#6BA6FF",
    secondary: "#8B7CF6",
    dark: "#0F1118",
  },
  {
    id: "ren",
    name: "Ren",
    tagline: "The Memory Keeper",
    description: "Empathetic, expressive, soft. A close friend who notices feelings.",
    personality: "Calm & Balanced",
    primary: "#E8919E",
    secondary: "#E8A891",
    dark: "#180F12",
  },
];

export function getCompanion(id: string): Companion {
  return companions.find((c) => c.id === id) ?? companions[0];
}
