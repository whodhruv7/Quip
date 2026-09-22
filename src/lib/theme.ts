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
  // Accent/tint overrides live as inline vars — re-derive them against the
  // new palette (e.g. --quip-accent-deep flips for dark vs light themes).
  reapplyCompanionTint();
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

// ─── Appearance extras (UX-042/043/045/046) ──────────────────────────────────
// UI type scale + chat density toggle data-* attributes on <html>; the accent
// override + companion tint re-color the --quip-accent* CSS variables INLINE
// so they deliberately win over every [data-theme] palette until reset.

export type UISize = "compact" | "comfortable" | "spacious";
export type UIDensity = "comfortable" | "compact";

const SIZE_KEY = "quip.uiSize";
const DENSITY_KEY = "quip.density";
const ACCENT_KEY = "quip.accent";
const TINT_KEY = "quip.companionTint";

const ACCENT_VARS = ["--quip-accent", "--quip-accent-2", "--quip-accent-3", "--quip-accent-deep"] as const;

export function isUISize(v: unknown): v is UISize {
  return v === "compact" || v === "comfortable" || v === "spacious";
}

export function isUIDensity(v: unknown): v is UIDensity {
  return v === "comfortable" || v === "compact";
}

/** UX-042: compact/comfortable/spacious type scale (persisted). */
export function applyUIScale(size: UISize): void {
  try {
    const el = document.documentElement;
    if (size === "comfortable") el.removeAttribute("data-quip-size");
    else el.setAttribute("data-quip-size", size);
    localStorage.setItem(SIZE_KEY, size);
  } catch {
    /* a broken localStorage must never break the companion */
  }
}

/** UX-046: comfortable/compact chat line spacing (persisted). */
export function applyDensity(density: UIDensity): void {
  try {
    const el = document.documentElement;
    if (density === "comfortable") el.removeAttribute("data-quip-density");
    else el.setAttribute("data-quip-density", density);
    localStorage.setItem(DENSITY_KEY, density);
  } catch {
    /* ignore */
  }
}

/** Saved choices — used at boot so settings survive restart. */
export function savedUISize(): UISize {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    return isUISize(v) ? v : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function savedDensity(): UIDensity {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    return isUIDensity(v) ? v : "comfortable";
  } catch {
    return "comfortable";
  }
}

/** Parse a CSS color (hex / rgb() / hsl()) or an HSL hue NUMBER into an
 *  "r, g, b" triplet. Returns null when the input is not understood. */
export function parseColorTriplet(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number" && Number.isFinite(input)) {
    return hslTriplet(((input % 360) + 360) % 360, 0.7, 0.56);
  }
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  const hex = s.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(hex) || /^[0-9a-f]{6}$/.test(hex)) {
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const n = parseInt(full, 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  const rgb = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return `${Math.round(+rgb[1])}, ${Math.round(+rgb[2])}, ${Math.round(+rgb[3])}`;
  const hsl = s.match(/hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%?[,\s]+([\d.]+)%?/);
  if (hsl) return hslTriplet(+hsl[1], Math.min(1, +hsl[2] / 100), Math.min(1, +hsl[3] / 100));
  return null;
}

function hslTriplet(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255);
  return `${to(r)}, ${to(g)}, ${to(b)}`;
}

function mixTriplet(triplet: string, toward: "white" | "black", amount: number): string {
  const [r, g, b] = triplet.split(",").map((v) => parseFloat(v.trim()));
  const target = toward === "white" ? 255 : 0;
  const mix = (v: number) => Math.round(v + (target - v) * amount);
  return `${mix(r)}, ${mix(g)}, ${mix(b)}`;
}

function applyAccentTriplet(triplet: string): void {
  const el = document.documentElement;
  const dark = isDarkTheme(currentTheme());
  el.style.setProperty("--quip-accent", triplet);
  el.style.setProperty("--quip-accent-2", mixTriplet(triplet, "white", 0.14));
  el.style.setProperty("--quip-accent-3", mixTriplet(triplet, "white", 0.3));
  el.style.setProperty("--quip-accent-deep", dark ? mixTriplet(triplet, "white", 0.18) : mixTriplet(triplet, "black", 0.28));
}

function clearAccentTriplet(): void {
  const el = document.documentElement;
  for (const name of ACCENT_VARS) el.style.removeProperty(name);
}

/** UX-043: persistent accent override. A CSS color string, an HSL hue
 *  number, or null to reset to the active theme's palette. */
export function applyAccent(color: string | number | null): void {
  try {
    if (color === null || color === undefined || color === "") localStorage.removeItem(ACCENT_KEY);
    else localStorage.setItem(ACCENT_KEY, String(color));
  } catch {
    /* ignore */
  }
  reapplyAccentOverride();
}

export function savedAccent(): string | null {
  try {
    return localStorage.getItem(ACCENT_KEY);
  } catch {
    return null;
  }
}

/** Re-apply (or clear) the stored accent override — cheap enough to call
 *  after every theme switch so the palette and the override agree. */
export function reapplyAccentOverride(): void {
  const triplet = parseColorTriplet(savedAccent());
  if (triplet) applyAccentTriplet(triplet);
  else clearAccentTriplet();
}

/** UX-045: companion re-tint — the active companion's primary color takes
 *  over --quip-accent* while enabled. null clears it (falls back to any
 *  accent override, then to the plain theme). */
export function applyCompanionTint(hexOrNull: string | null): void {
  try {
    if (hexOrNull) localStorage.setItem(TINT_KEY, hexOrNull);
    else localStorage.removeItem(TINT_KEY);
  } catch {
    /* ignore */
  }
  reapplyCompanionTint();
}

export function savedCompanionTint(): string | null {
  try {
    return localStorage.getItem(TINT_KEY);
  } catch {
    return null;
  }
}

export function reapplyCompanionTint(): void {
  const triplet = parseColorTriplet(savedCompanionTint());
  if (triplet) applyAccentTriplet(triplet);
  else reapplyAccentOverride();
}

/** Boot / after-theme-change: put every saved appearance extra in place.
 *  Priority: companion tint > accent override > the theme's own palette. */
export function applyThemeExtras(): void {
  reapplyAccentOverride();
  reapplyCompanionTint();
  const size = savedUISize();
  if (size !== "comfortable") applyUIScale(size);
  const density = savedDensity();
  if (density !== "comfortable") applyDensity(density);
}
