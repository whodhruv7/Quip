// Quip — UI theme system (pure helpers + DOM application).
// ─────────────────────────────────────────────────────────────────────────────
// The panel is glass over the desktop, themed by CSS custom properties in
// index.css. This module persists the user's choice in localStorage and
// applies it to <html data-theme="…">. "violet" is the BRAND theme — the
// palette of the Quip logo (ink black + violet glow + soft blue).
// Pure helpers are exported separately so tests can verify the catalog.
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeId = "violet" | "light" | "aqua" | "pink" | "black";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  /** Representative swatch colors for the Settings picker (CSS colors). */
  swatch: [string, string];
  /** Whether the theme is dark (affects a few inline styles). */
  dark: boolean;
}

export const THEMES: ThemeMeta[] = [
  {
    id: "violet",
    label: "Quip Violet",
    swatch: ["#131318", "#8b7cf8"],
    dark: true,
  },
  { id: "light", label: "Daylight", swatch: ["#ffffff", "#6fd6ff"], dark: false },
  { id: "aqua", label: "Aqua", swatch: ["#f0f9ff", "#3fb8ef"], dark: false },
  { id: "pink", label: "Blossom", swatch: ["#fff5fa", "#f472d6"], dark: false },
  { id: "black", label: "Ink", swatch: ["#121318", "#6fd6ff"], dark: true },
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
export function applyTheme(id: ThemeId): void {
  try {
    document.documentElement.setAttribute("data-theme", id);
    localStorage.setItem(STORAGE_KEY, id);
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
