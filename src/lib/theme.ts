// Quip — UI theme system (union of the brand round + the 10-palette round).
// ─────────────────────────────────────────────────────────────────────────────
// The panel is glass over the desktop, themed by CSS custom properties in
// index.css. This module persists the user's choice in localStorage and
// applies it to <html data-theme="…"> before first paint — no flash of the
// wrong chrome.
//
// "violet" is the BRAND theme (the Quip logo palette: ink black + violet
// glow + soft blue) and stays first + default. The remaining palettes are
// the extended Quip palette the user asked for ("add more colors from our
// pallete"): Cloud, Aqua, Bubblegum, Mint, Sunset, Ocean, Forest, Midnight,
// Carbon.
//
// Pure helpers are exported separately so tests can verify the catalog.
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeId =
  | "violet"
  | "light"
  | "aqua"
  | "pink"
  | "mint"
  | "sunset"
  | "ocean"
  | "forest"
  | "midnight"
  | "black";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  /** Representative swatch colors for the Settings picker (CSS colors). */
  swatch: [string, string];
  /** Whether the theme is dark (affects a few inline styles). */
  dark: boolean;
}

export const THEMES: ThemeMeta[] = [
  { id: "violet", label: "Quip Violet", swatch: ["#131318", "#8b7cf8"], dark: true },
  { id: "light", label: "Cloud", swatch: ["#ffffff", "#6fd6ff"], dark: false },
  { id: "aqua", label: "Aqua", swatch: ["#f0f9ff", "#3fb8ef"], dark: false },
  { id: "pink", label: "Bubblegum", swatch: ["#fff5fa", "#f472d6"], dark: false },
  { id: "mint", label: "Mint", swatch: ["#34d399", "#a7f3d0"], dark: false },
  { id: "sunset", label: "Sunset", swatch: ["#fb923c", "#f472b6"], dark: false },
  { id: "ocean", label: "Ocean", swatch: ["#38bdf8", "#0ea5e9"], dark: false },
  { id: "forest", label: "Forest", swatch: ["#4ade80", "#166534"], dark: false },
  { id: "midnight", label: "Midnight", swatch: ["#818cf8", "#38bdf8"], dark: true },
  { id: "black", label: "Carbon", swatch: ["#121318", "#6fd6ff"], dark: true },
];

export const DEFAULT_THEME: ThemeId = "violet";
const STORAGE_KEY = "quip-theme";

export function isThemeId(v: string | null | undefined): v is ThemeId {
  return !!v && THEMES.some((t) => t.id === v);
}

/** Pure: which theme id should be active given a stored value. */
export function resolveTheme(stored: string | null | undefined): ThemeId {
  return isThemeId(stored) ? stored : DEFAULT_THEME;
}

/** Apply to the document + persist. Safe to call before React mounts. */
export function applyTheme(id: string): void {
  const theme = resolveTheme(id);
  try {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* a broken localStorage must never break the companion */
  }
}

/** Boot-time: read the saved choice and apply it. Returns the active id. */
export function initTheme(): ThemeId {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* private mode etc. */
  }
  const theme = resolveTheme(stored);
  applyTheme(theme);
  return theme;
}

/** Alias kept from the first theme round — same behavior as initTheme(). */
export function applySavedTheme(): ThemeId {
  return initTheme();
}

/** The currently applied theme id (reads the live DOM attribute). */
export function currentTheme(): string {
  return document.documentElement.getAttribute("data-theme") ?? DEFAULT_THEME;
}

/** True when the active theme is a dark one (UI adapts subtle chrome). */
export function isDarkTheme(id?: string): boolean {
  const meta = THEMES.find((t) => t.id === resolveTheme(id ?? currentTheme()));
  return !!meta?.dark;
}
