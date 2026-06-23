// Quip Phone App — Design System V2
// ─────────────────────────────────────────────────────────────────────────────
// Calm. Premium. Apple + Linear + Raycast level.
// 8pt grid. Inter font. Four weights. Restrained colors.
// Every value is deliberate. Nothing is random.

// ─── Colors ──────────────────────────────────────────────────────────────────
// Per directive: #0B0B0C bg, #111113 surface, #18181B card
export const colors = {
  bg: "#0B0B0C",
  surface: "#111113",
  card: "#18181B",
  cardHover: "#1E1E22",

  // Glass
  glass: "rgba(24, 24, 27, 0.72)",
  glassLight: "rgba(255, 255, 255, 0.04)",
  glassHover: "rgba(255, 255, 255, 0.08)",

  // Text — careful hierarchy
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255, 255, 255, 0.65)",
  textTertiary: "rgba(255, 255, 255, 0.40)",
  textQuaternary: "rgba(255, 255, 255, 0.25)",

  // Borders — barely visible
  border: "rgba(255, 255, 255, 0.06)",
  borderStrong: "rgba(255, 255, 255, 0.12)",

  // Accent — subtle blue (per directive)
  accent: "#6BA6FF",
  accentSoft: "rgba(107, 166, 255, 0.12)",

  // Semantic — calmer
  success: "#57D487",
  warning: "#FFBF69",
  danger: "#FF6B6B",

  // Overlays
  overlay: "rgba(0, 0, 0, 0.50)",
  overlayLight: "rgba(0, 0, 0, 0.30)",
} as const;

// ─── Spacing (8pt grid) ──────────────────────────────────────────────────────
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
  "3xl": 40,
  "4xl": 48,
  "5xl": 64,
} as const;

// ─── Border Radius (per directive: 12, 16, 20, 24) ──────────────────────────
export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  full: 9999,
} as const;

// ─── Typography ──────────────────────────────────────────────────────────────
// Per directive: Inter, four weights only
export const typography = {
  fontFamily: "var(--font-inter), -apple-system, system-ui, sans-serif",
  fontMono: "'SF Mono', ui-monospace, monospace",
  // Per directive: Display 32, Title 24, Section 20, Body 16, Caption 14, Small 12
  sizes: {
    display: 32,
    title: 24,
    section: 20,
    body: 16,
    caption: 14,
    small: 12,
  },
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  letterSpacing: {
    tight: -0.02,
    normal: 0,
    wide: 0.01,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.6,
  },
} as const;

// ─── Elevation (almost invisible shadows) ────────────────────────────────────
export const elevation = {
  none: "none",
  xs: "0 1px 2px rgba(0,0,0,0.20)",
  sm: "0 2px 8px rgba(0,0,0,0.20)",
  md: "0 4px 16px rgba(0,0,0,0.24)",
  lg: "0 8px 32px rgba(0,0,0,0.30)",
} as const;

// ─── Motion (per directive: 120ms, 180ms, 240ms) ─────────────────────────────
export const motion = {
  duration: {
    fast: 0.12,       // 120ms
    normal: 0.18,     // 180ms
    slow: 0.24,       // 240ms
  },
  // Spring physics — no bounce, no exaggerated movement
  spring: { type: "spring" as const, stiffness: 400, damping: 30 },
  springSoft: { type: "spring" as const, stiffness: 300, damping: 28 },
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
} as const;

// ─── Themes (calmer, no rainbow) ─────────────────────────────────────────────
export interface QuipTheme {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  glow: string;
}

export const themes: QuipTheme[] = [
  {
    id: "aurora",
    name: "Aurora",
    primary: "#8B7CF6",
    secondary: "#6BA6FF",
    glow: "rgba(139, 124, 246, 0.20)",
  },
  {
    id: "ocean",
    name: "Ocean",
    primary: "#6BA6FF",
    secondary: "#5B9FE8",
    glow: "rgba(107, 166, 255, 0.20)",
  },
  {
    id: "blush",
    name: "Blush",
    primary: "#E8919E",
    secondary: "#E8A891",
    glow: "rgba(232, 145, 158, 0.20)",
  },
];

// ─── Styles (4 keyboard styles) ──────────────────────────────────────────────
export interface QuipStyle {
  id: string;
  name: string;
}

export const styles: QuipStyle[] = [
  { id: "glass", name: "Glass" },
  { id: "glow", name: "Glow" },
  { id: "gradient", name: "Gradient" },
  { id: "minimal", name: "Minimal" },
];

// ─── Tones (no childish emojis per directive) ────────────────────────────────
export interface Tone {
  id: string;
  name: string;
}

export const tones: Tone[] = [
  { id: "calm", name: "Calm" },
  { id: "smooth", name: "Smooth" },
  { id: "funny", name: "Funny" },
  { id: "savage", name: "Savage" },
  { id: "smart", name: "Smart" },
  { id: "confident", name: "Confident" },
  { id: "professional", name: "Professional" },
];

// ─── Companions ──────────────────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function getTheme(id: string): QuipTheme {
  return themes.find((t) => t.id === id) ?? themes[0];
}

export function getStyle(id: string): QuipStyle {
  return styles.find((s) => s.id === id) ?? styles[0];
}

export function getCompanion(id: string): Companion {
  return companions.find((c) => c.id === id) ?? companions[0];
}
